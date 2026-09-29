import Capacitor
import Foundation
import QuickLook

/// The app's private folder for native files: documents opened in Quick Look (docs/...)
/// and media waiting for the background sender (outbox/...).
enum AppFiles {
    static var base: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChatApp", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Resolves a relative path inside `base` (never outside it).
    static func resolve(_ path: String?) throws -> URL {
        guard let path = path, !path.isEmpty else { throw error("Missing path") }
        let root = base.standardizedFileURL
        let url = root.appendingPathComponent(path).standardizedFileURL
        guard url.path.hasPrefix(root.path + "/") else { throw error("Invalid path") }
        return url
    }

    static func error(_ message: String) -> NSError {
        NSError(domain: "ChatAppFiles", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// iOS side of DeviceFilesPlugin.java: saves files written by the web layer in base64
/// chunks, and opens documents in Quick Look (PDF, Word, Excel, text...) the way WhatsApp
/// does; Quick Look's share button offers "Open in..." other apps.
@objc(DeviceFilesPlugin)
public class DeviceFilesPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource {
    public let identifier = "DeviceFilesPlugin"
    public let jsName = "DeviceFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    private var previewURL: URL?

    @objc func write(_ call: CAPPluginCall) {
        do {
            let url = try AppFiles.resolve(call.getString("path"))
            guard let data = Data(base64Encoded: call.getString("data") ?? "") else {
                call.reject("Invalid data")
                return
            }
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if call.getBool("append") ?? false, FileManager.default.fileExists(atPath: url.path) {
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(data)
            } else {
                try data.write(to: url, options: .atomic)
            }
            call.resolve()
        } catch {
            call.reject("Could not save file", nil, error)
        }
    }

    @objc func stat(_ call: CAPPluginCall) {
        do {
            let url = try AppFiles.resolve(call.getString("path"))
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
            call.resolve(["exists": attributes != nil, "size": size])
        } catch {
            call.reject("Invalid path", nil, error)
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        do {
            let url = try AppFiles.resolve(call.getString("path"))
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            call.resolve()
        } catch {
            call.reject("Could not delete file", nil, error)
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        let url: URL
        do {
            url = try AppFiles.resolve(call.getString("path"))
        } catch {
            call.reject("Could not open file", nil, error)
            return
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            call.reject("File not found")
            return
        }
        DispatchQueue.main.async {
            guard QLPreviewController.canPreview(url as NSURL) else {
                call.reject("No app on this phone can open this type of file", "NO_APP")
                return
            }
            self.previewURL = url
            let preview = QLPreviewController()
            preview.dataSource = self
            self.bridge?.viewController?.present(preview, animated: true)
            call.resolve()
        }
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        previewURL == nil ? 0 : 1
    }

    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (previewURL ?? AppFiles.base) as NSURL
    }
}
