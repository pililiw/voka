import Cocoa
import InputMethodKit
import os
import VokaCore

// This process sees what is typed: it must not leave a core file with its memory behind.
var noCoreFile = rlimit(rlim_cur: 0, rlim_max: 0)
_ = setrlimit(RLIMIT_CORE, &noCoreFile)

if let result = InputSourceCommands.run(arguments: CommandLine.arguments) {
    exit(result)
}

#if DEBUG
if let result = WindowPreview.run(arguments: CommandLine.arguments) {
    exit(result)
}
#endif

// Must run before anything creates an IMKServer: see LaunchGuard.
do {
    let me = ProcessInfo.processInfo.processIdentifier
    let others = (Bundle.main.bundleIdentifier.map { NSRunningApplication.runningApplications(withBundleIdentifier: $0) } ?? [])
        .map(\.processIdentifier)
        .filter { $0 != me && kill($0, 0) == 0 }
    if let reason = LaunchGuard.refusal(bundlePath: Bundle.main.bundlePath, otherLiveInstances: others) {
        Log.app.notice("not starting the input method server: \(PathPrivacy.redactingHome(reason), privacy: .public)")
        exit(0)
    }
}

/// Owns the input server for the lifetime of the application; it is created once AppKit has launched.
final class VokaApplicationDelegate: NSObject, NSApplicationDelegate {
    private var inputServer: IMKServer?
    /// An input method answers keystrokes for whichever application is in front. Without this the
    /// system treats it as an idle background process and runs it at reduced speed.
    private let activity = ProcessInfo.processInfo.beginActivity(
        options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical], reason: "Handling keystrokes")

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let bundleID = Bundle.main.bundleIdentifier,
              let connectionName = Bundle.main.object(forInfoDictionaryKey: "InputMethodConnectionName") as? String,
              let server = IMKServer(name: connectionName, bundleIdentifier: bundleID) else {
            Log.app.error("cannot initialize InputMethodKit server; check the installed bundle metadata")
            exit(1)
        }
        inputServer = server
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        Log.app.notice("InputMethodKit server started, bundle=\(bundleID, privacy: .public), build=\(build, privacy: .public)")

        NSApp.mainMenu = VokaWindowController.makeMainMenu()
        SharedRuntime.follow(Settings.shared)
        if SharedRuntime.js.isReady {
            // The model is timed in the background; report how it settled.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                // The state in fixed words is public; the status line can quote an error, so it is not.
                let state = SharedRuntime.logStatus
                let detail = PathPrivacy.redactingHome(SharedRuntime.engineStatus)
                Log.app.notice("\(state, privacy: .public) (\(detail, privacy: .private))")
            }
        } else {
            let reason = PathPrivacy.redactingHome(SharedRuntime.js.lastError)
            Log.app.error("engine unavailable, keys are passed through (\(reason, privacy: .private))")
        }

        // The window opens by itself the first time Voka runs, when the installer asks for it, and
        // for as long as Voka still has to be enabled.
        let firstRun = Settings.shared.takeFirstRun()
        if firstRun {
            VokaWindowController.shared.show(reason: "first run")
        } else if CommandLine.arguments.contains("--show-window") {
            VokaWindowController.shared.show(reason: "--show-window")
        } else if case .enabled = InputSource.state() {
        } else {
            VokaWindowController.shared.show(reason: "not enabled")
        }
    }

    /// The user opened the application while it was running (Finder, Spotlight, `open`).
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        VokaWindowController.shared.show(reason: "opened")
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

let app = NSApplication.shared
let delegate = VokaApplicationDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
withExtendedLifetime(delegate) {
    app.run()
}
