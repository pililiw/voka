import AppKit

// "Voka" in the Applications folder: the entry that Spotlight, Launchpad and Finder show. The input
// method itself lives in an Input Methods folder, where macOS does not list applications. This
// program only asks the input method to show its window, and exits.
let candidates = [
    NSHomeDirectory() + "/Library/Input Methods/Voka.app",
    "/Library/Input Methods/Voka.app",
]

guard let path = candidates.first(where: { FileManager.default.fileExists(atPath: $0 + "/Contents/MacOS/VokaIME") }) else {
    let alert = NSAlert()
    alert.messageText = "Voka is not installed"
    alert.informativeText = "Install Voka again from its installer package."
    alert.runModal()
    exit(1)
}

let configuration = NSWorkspace.OpenConfiguration()
// A running input method shows its window when it is opened again; a new one is told to.
configuration.arguments = ["--show-window"]
configuration.activates = true
let done = DispatchSemaphore(value: 0)
NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: configuration) { _, _ in done.signal() }
_ = done.wait(timeout: .now() + 10)
