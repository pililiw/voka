import Foundation

/// A fresh document snapshot. An empty prefix at position zero is known, not a read failure.
public struct EditContext {
    public let selection: NSRange
    public let marked: NSRange
    public let anchor: Int?
    public let before: String
    public let after: String
    public let canReadBefore: Bool

    public static func valid(_ range: NSRange) -> Bool {
        range.location != NSNotFound && range.length != NSNotFound &&
        range.location >= 0 && range.length >= 0 && range.location <= Int.max - range.length
    }

    public init(selection: NSRange, marked: NSRange, read: (NSRange) -> String?) {
        self.selection = selection
        self.marked = marked
        let hasMarked = Self.valid(marked) && marked.length > 0
        let start = hasMarked ? marked.location : (Self.valid(selection) ? selection.location : nil)
        anchor = start
        if let start = start {
            let count = min(start, 90)
            let text = count == 0 ? "" : read(NSRange(location: start - count, length: count))
            canReadBefore = text?.utf16.count == count
            before = canReadBefore ? (text ?? "") : ""
            let end = hasMarked ? NSMaxRange(marked) : NSMaxRange(selection)
            after = read(NSRange(location: end, length: 1)) ?? ""
        } else {
            before = ""
            after = ""
            canReadBefore = false
        }
    }

    public var hasSelection: Bool { Self.valid(selection) && selection.length > 0 }
    public var canReplaceBefore: Bool { canReadBefore && Self.valid(selection) && !hasSelection }

    public func hostJSON() -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [
            "hasSelection": hasSelection, "after": after, "canReplaceBefore": canReplaceBefore
        ]) else { return #"{"canReplaceBefore":false}"# }
        return String(decoding: data, as: UTF8.self)
    }

    /// Validate the exact suffix again before changing already committed text.
    public func replacementRange(deleting count: Int, read: (NSRange) -> String?) -> NSRange? {
        guard count > 0, canReplaceBefore, let start = anchor, start >= count,
              before.utf16.count >= count else { return nil }
        let range = NSRange(location: start - count, length: count)
        let suffix = (before as NSString).substring(from: before.utf16.count - count)
        guard read(range) == suffix else { return nil }
        return range
    }
}
