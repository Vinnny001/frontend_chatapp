import Capacitor
import Foundation

/// iOS side of OutboxPlugin.java. Messages written offline are handed to a *background*
/// URLSession: iOS keeps the transfer queued, waits for the network and completes it even
/// while the app is suspended or has been closed by the system, relaunching the app in the
/// background to chain the next step (upload the photo, then send the message).
/// iOS cancels background transfers only if the user force-quits the app from the app
/// switcher; those messages are sent the next time the app is opened.
@objc(OutboxPlugin)
public class OutboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OutboxPlugin"
    public let jsName = "Outbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enqueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeDelivered", returnType: CAPPluginReturnPromise),
    ]

    /// id, url (send endpoint), token, body (message JSON without media). For media messages
    /// also: uploadUrl, filePath (relative to the app files folder), fileName, mime, mediaExtra.
    @objc func enqueue(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = call.getString("url"),
              let token = call.getString("token"), let body = call.getString("body") else {
            call.reject("id, url, token and body are required")
            return
        }
        var job = OutboxJob(id: id, url: url, token: token, body: body)
        if let filePath = call.getString("filePath") {
            job.uploadUrl = call.getString("uploadUrl")
            job.filePath = filePath
            job.fileName = call.getString("fileName") ?? "file"
            job.mime = call.getString("mime") ?? "application/octet-stream"
            job.mediaExtra = call.getString("mediaExtra") ?? "{}"
        }
        OutboxSender.shared.enqueue(job)
        call.resolve()
    }

    /// The app sent it itself: drop the job and any copied file.
    @objc func cancel(_ call: CAPPluginCall) {
        if let id = call.getString("id") { OutboxSender.shared.cancel(id) }
        call.resolve()
    }

    /// Server replies ({ message, duplicate }) for messages delivered while the app was closed.
    @objc func takeDelivered(_ call: CAPPluginCall) {
        call.resolve(["replies": OutboxSender.shared.takeDelivered()])
    }
}

struct OutboxJob: Codable {
    let id: String
    let url: String
    let token: String
    let body: String
    var uploadUrl: String?
    var filePath: String?
    var fileName: String?
    var mime: String?
    var mediaExtra: String?
    var uploaded: String? // upload reply JSON, so a retry never uploads twice
    var attempts: Int = 0
}

final class OutboxSender: NSObject, URLSessionDataDelegate {
    static let shared = OutboxSender()
    static let sessionId = "com.jujatech.chatapp.outbox"

    /// Set by the AppDelegate when iOS relaunches the app for background transfer events.
    var backgroundCompletion: (() -> Void)?

    private let queue = DispatchQueue(label: "com.jujatech.chatapp.outbox.state")
    private var responses: [Int: Data] = [:] // taskIdentifier -> reply body
    private let defaults = UserDefaults.standard
    private let jobsKey = "chat_outbox_jobs"
    private let deliveredKey = "chat_outbox_delivered"
    private let maxAttempts = 25

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: OutboxSender.sessionId)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Reconnects to the background session (call at launch).
    func activate() {
        _ = session
    }

    func enqueue(_ job: OutboxJob) {
        queue.sync {
            var jobs = loadJobs()
            if jobs[job.id] == nil { jobs[job.id] = job } // queuing twice keeps the first job
            saveJobs(jobs)
        }
        startNextStep(job.id)
    }

    func cancel(_ id: String) {
        session.getAllTasks { tasks in
            tasks.filter { $0.taskDescription?.hasSuffix(":" + id) == true }.forEach { $0.cancel() }
        }
        forget(id)
    }

    func takeDelivered() -> [String] {
        queue.sync {
            let replies = (defaults.dictionary(forKey: deliveredKey) as? [String: String]) ?? [:]
            defaults.removeObject(forKey: deliveredKey)
            return Array(replies.values)
        }
    }

    // MARK: - Steps

    private func startNextStep(_ id: String, delay: TimeInterval = 0) {
        guard let job = queue.sync(execute: { loadJobs()[id] }) else { return }
        session.getAllTasks { tasks in
            let busy = tasks.contains {
                $0.taskDescription?.hasSuffix(":" + id) == true && $0.state != .completed && $0.state != .canceling
            }
            if busy { return }
            do {
                let task: URLSessionUploadTask
                if job.filePath != nil && job.uploaded == nil {
                    task = try self.makeUploadTask(job) // step 1: upload the photo/video/voice note
                } else {
                    task = try self.makeSendTask(job) // step 2 (or only step): send the message
                }
                if delay > 0 { task.earliestBeginDate = Date().addingTimeInterval(delay) }
                task.resume()
            } catch {
                self.forget(id) // e.g. the queued file is gone; the app still shows it unsent
            }
        }
    }

    /// Background sessions can only upload from a file, so the multipart body is built on disk.
    private func makeUploadTask(_ job: OutboxJob) throws -> URLSessionUploadTask {
        guard let uploadUrl = job.uploadUrl, let url = URL(string: uploadUrl) else { throw AppFiles.error("Missing upload URL") }
        let file = try AppFiles.resolve(job.filePath)
        guard FileManager.default.fileExists(atPath: file.path) else { throw AppFiles.error("Queued file is missing") }

        let boundary = "ChatAppBoundary\(UUID().uuidString)"
        let bodyURL = try AppFiles.resolve("outbox/\(job.id).upload")
        FileManager.default.createFile(atPath: bodyURL.path, contents: nil)
        let out = try FileHandle(forWritingTo: bodyURL)
        defer { try? out.close() }
        let name = (job.fileName ?? "file").replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        out.write(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(job.mime ?? "application/octet-stream")\r\n\r\n".utf8))
        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        while true {
            let chunk = input.readData(ofLength: 256 * 1024)
            if chunk.isEmpty { break }
            out.write(chunk)
        }
        out.write(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(job.token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let task = session.uploadTask(with: request, fromFile: bodyURL)
        task.taskDescription = "upload:\(job.id)"
        return task
    }

    private func makeSendTask(_ job: OutboxJob) throws -> URLSessionUploadTask {
        guard let url = URL(string: job.url) else { throw AppFiles.error("Invalid URL") }
        var body = (try JSONSerialization.jsonObject(with: Data(job.body.utf8)) as? [String: Any]) ?? [:]
        if let uploaded = job.uploaded,
           var media = try JSONSerialization.jsonObject(with: Data(uploaded.utf8)) as? [String: Any] {
            if let extra = try? JSONSerialization.jsonObject(with: Data((job.mediaExtra ?? "{}").utf8)) as? [String: Any] {
                media.merge(extra) { _, new in new }
            }
            body["media"] = media
        }
        let bodyURL = try AppFiles.resolve("outbox/\(job.id).json")
        try FileManager.default.createDirectory(at: bodyURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: body).write(to: bodyURL, options: .atomic)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(job.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let task = session.uploadTask(with: request, fromFile: bodyURL)
        task.taskDescription = "send:\(job.id)"
        return task
    }

    // MARK: - URLSession delegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queue.sync { responses[dataTask.taskIdentifier, default: Data()].append(data) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let data = queue.sync { responses.removeValue(forKey: task.taskIdentifier) } ?? Data()
        guard let description = task.taskDescription, let sep = description.firstIndex(of: ":") else { return }
        let step = String(description[..<sep])
        let id = String(description[description.index(after: sep)...])
        if (error as NSError?)?.code == NSURLErrorCancelled { return }

        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if error == nil, (200..<300).contains(status) {
            let reply = String(data: data, encoding: .utf8) ?? "{}"
            if step == "upload" {
                update(id) { $0?.uploaded = reply }
                removeFile("outbox/\(id).upload")
                startNextStep(id)
            } else {
                queue.sync {
                    var delivered = (defaults.dictionary(forKey: deliveredKey) as? [String: String]) ?? [:]
                    delivered[id] = reply
                    defaults.set(delivered, forKey: deliveredKey)
                }
                forget(id)
            }
            return
        }
        // Rejected for good (signed out, removed from the chat, too large...): give up; the app
        // still shows the message as not sent so the user can retry or delete it.
        if error == nil, (400..<500).contains(status), status != 408, status != 429 {
            forget(id)
            return
        }
        // Temporary problem: try again with exponential backoff.
        var attempts = maxAttempts
        update(id) { job in
            job?.attempts += 1
            attempts = job?.attempts ?? maxAttempts
        }
        if attempts >= maxAttempts {
            forget(id)
            return
        }
        startNextStep(id, delay: min(30 * pow(2, Double(attempts - 1)), 3600))
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }

    // MARK: - Persistence

    private func loadJobs() -> [String: OutboxJob] {
        guard let data = defaults.data(forKey: jobsKey),
              let jobs = try? JSONDecoder().decode([String: OutboxJob].self, from: data) else { return [:] }
        return jobs
    }

    private func saveJobs(_ jobs: [String: OutboxJob]) {
        defaults.set(try? JSONEncoder().encode(jobs), forKey: jobsKey)
    }

    private func update(_ id: String, _ change: (inout OutboxJob?) -> Void) {
        queue.sync {
            var jobs = loadJobs()
            var job = jobs[id]
            change(&job)
            jobs[id] = job
            saveJobs(jobs)
        }
    }

    private func forget(_ id: String) {
        let filePath = queue.sync { () -> String? in
            var jobs = loadJobs()
            let job = jobs.removeValue(forKey: id)
            saveJobs(jobs)
            return job?.filePath
        }
        if let filePath = filePath { removeFile(filePath) }
        removeFile("outbox/\(id).upload")
        removeFile("outbox/\(id).json")
    }

    private func removeFile(_ path: String) {
        if let url = try? AppFiles.resolve(path) { try? FileManager.default.removeItem(at: url) }
    }
}
