import Capacitor
import UIKit

/// Capacitor's bridge view controller plus the app's own native plugins
/// (Main.storyboard uses this class).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OutboxPlugin())
        bridge?.registerPluginInstance(DeviceFilesPlugin())
    }
}
