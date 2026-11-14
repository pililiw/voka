import Foundation

/// Decides whether this process may start the input method server.
///
/// macOS keeps one InputMethodKit endpoint per bundle identifier, and creating an `IMKServer`
/// replaces it. A second copy of the app (a build folder copy that LaunchServices launches on demand,
/// for example) would take the endpoint away from the running input method and leave it dead on exit.
/// So only the installed copy may serve, and only one instance of it.
public enum LaunchGuard {
    public static func installDirectories(home: String = NSHomeDirectory()) -> [String] {
        [home + "/Library/Input Methods/", "/Library/Input Methods/"]
    }

    /// True when `bundlePath` is an app directly inside an Input Methods folder.
    public static func isInstalledLocation(bundlePath: String, home: String = NSHomeDirectory()) -> Bool {
        let path = URL(fileURLWithPath: bundlePath).standardizedFileURL.resolvingSymlinksInPath().path
        return installDirectories(home: home).contains { dir in
            let resolved = URL(fileURLWithPath: dir).standardizedFileURL.resolvingSymlinksInPath().path + "/"
            guard path.hasPrefix(resolved) else { return false }
            return !path.dropFirst(resolved.count).contains("/")
        }
    }

    /// Nil when the server may start; otherwise the reason it must not.
    public static func refusal(bundlePath: String, home: String = NSHomeDirectory(), otherLiveInstances: [Int32]) -> String? {
        if !isInstalledLocation(bundlePath: bundlePath, home: home) {
            return "not started from an Input Methods folder (\(bundlePath))"
        }
        if let pid = otherLiveInstances.first {
            return "another instance is already running (pid \(pid))"
        }
        return nil
    }
}
