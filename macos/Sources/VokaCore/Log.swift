import Foundation
import os

/// Where Voka writes to the system log.
///
/// An input method sees what is typed in every application, so the log is kept to what a bug report
/// needs: versions, states and reasons in fixed words. Typed text, the text around the caret and
/// candidate words are never logged. Text that comes from an error (a JavaScript exception, a Core ML
/// failure) is logged as private, which macOS shows as `<private>` unless the owner of the Mac turns
/// private logging on.
public enum Log {
    public static let subsystem = "sh.pili.inputmethod.Voka"
    public static let app = Logger(subsystem: subsystem, category: "app")
}

public enum PathPrivacy {
    /// `text` with the home directory written as `~`, so that a path in the log or in output that
    /// people paste into a bug report does not carry their account name.
    public static func redactingHome(_ text: String, home: String = NSHomeDirectory()) -> String {
        // "/" (no home directory) would match every path.
        guard home.count > 1 else { return text }
        var result = ""
        var rest = Substring(text)
        while let range = rest.range(of: home) {
            result += String(rest[..<range.lowerBound])
            // Only a whole path is the home directory: /Users/al is not the start of /Users/alice.
            let after = rest[range.upperBound...].first
            let continuesName = after.map { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" || $0 == "." } ?? false
            result += continuesName ? String(rest[range]) : "~"
            rest = rest[range.upperBound...]
        }
        result += String(rest)
        return result
    }
}
