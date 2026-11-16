import Foundation
import XCTest
@testable import VokaCore

final class EditingSafetyTests: XCTestCase {
    private let noMarked = NSRange(location: NSNotFound, length: 0)

    private func context(_ text: String, selection: NSRange, marked: NSRange? = nil) -> EditContext {
        let doc = text as NSString
        return EditContext(selection: selection, marked: marked ?? noMarked) { range in
            guard EditContext.valid(range), NSMaxRange(range) <= doc.length else { return nil }
            return doc.substring(with: range)
        }
    }

    func testDocumentStartIsKnownEmptyContext() {
        let c = context("he was here", selection: NSRange(location: 0, length: 0))
        XCTAssertEqual(c.before, "")
        XCTAssertEqual(c.after, "h")
        XCTAssertTrue(c.canReadBefore)
        XCTAssertNil(c.replacementRange(deleting: 1) { _ in "x" })
    }

    func testUnreadableAndPartialContextNeverAuthorizeBackwardReplacement() {
        for result: String? in [nil, "a"] {
            let c = EditContext(selection: NSRange(location: 12, length: 0), marked: noMarked) { _ in result }
            XCTAssertEqual(c.before, "")
            XCTAssertFalse(c.canReplaceBefore)
        }
    }

    func testSelectionCannotAuthorizeDeletingThePreviousWord() {
        let c = context("behavior XYZ", selection: NSRange(location: 9, length: 3))
        XCTAssertTrue(c.hasSelection)
        XCTAssertFalse(c.canReplaceBefore)
        XCTAssertNil(c.replacementRange(deleting: 9) { _ in "behavior " })
    }

    func testReplacementUsesUTF16AndChecksTheActualOriginalSuffix() {
        let c = context("🙂 a apple", selection: NSRange(location: 10, length: 0),
                        marked: NSRange(location: 5, length: 5))
        XCTAssertEqual(c.before, "🙂 a ")
        XCTAssertEqual(c.replacementRange(deleting: 2) { _ in "a " }, NSRange(location: 3, length: 2))
        XCTAssertNil(c.replacementRange(deleting: 2) { _ in "x " })
        XCTAssertNil(c.replacementRange(deleting: 20) { _ in "" })
    }

    private func failingEngine(failMethod: String) throws -> (JSEngine, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let script = """
        var Voka = {
          count: 0, init: function() { return '{"ok":true}'; },
          newSession: function() { return 1; }, endSession: function() {}, reset: function() {},
          key: function(sid,key) {
            this.count++;
            if ('\(failMethod)' === 'key' && this.count === 2) return 'invalid JSON';
            return JSON.stringify({handled:true,passThrough:false,deleteBack:0,commit:null,preedit:key,
              candidates:[],selected:0,tabIndex:-1,show:false});
          },
          flush: function() { return 'invalid JSON'; }
        };
        """
        let scriptURL = dir.appendingPathComponent("engine.js")
        let dictURL = dir.appendingPathComponent("dict.json")
        try script.write(to: scriptURL, atomically: true, encoding: .utf8)
        try "{}".write(to: dictURL, atomically: true, encoding: .utf8)
        let engine = JSEngine()
        XCTAssertTrue(engine.load(scriptURL: scriptURL, dictURL: dictURL))
        return (engine, dir)
    }

    func testBridgeFailureKeepsRawPreeditAndPassesTheFailingKeyThrough() throws {
        let (engine, dir) = try failingEngine(failMethod: "key")
        defer { try? FileManager.default.removeItem(at: dir) }
        let session = try XCTUnwrap(JSSessionDriver(engine: engine))
        let c = context("", selection: NSRange(location: 0, length: 0))
        XCTAssertEqual(session.key(KeyInput(key: "a"), context: c).preedit, "a")
        let failure = session.key(KeyInput(key: "b"), context: c)
        XCTAssertEqual(failure.commit, "a")
        XCTAssertTrue(failure.passThrough)
        XCTAssertEqual(session.preedit, "")
        XCTAssertFalse(session.key(KeyInput(key: "c"), context: c).handled)
        // The reason is shown in the input menu and may be logged: it names the call, and quotes
        // nothing of what the engine returned (that is what was being typed).
        let reason = try XCTUnwrap(session.failureReason)
        XCTAssertTrue(reason.hasPrefix("key:"), reason)
        XCTAssertFalse(reason.contains("invalid JSON"), reason)
    }

    func testEngineStackTracesDoNotNameTheScriptLocation() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let scriptURL = dir.appendingPathComponent("engine.js")
        let dictURL = dir.appendingPathComponent("dict.json")
        try "function fail() { throw new Error('broken'); }\nfail();".write(to: scriptURL, atomically: true, encoding: .utf8)
        try "{}".write(to: dictURL, atomically: true, encoding: .utf8)
        let engine = JSEngine()
        XCTAssertFalse(engine.load(scriptURL: scriptURL, dictURL: dictURL))
        XCTAssertTrue(engine.lastError.contains("broken"), engine.lastError)
        XCTAssertFalse(engine.lastError.contains(dir.lastPathComponent), engine.lastError)
    }

    func testHomeDirectoryIsWrittenAsTilde() {
        let home = "/Users/al"
        XCTAssertEqual(PathPrivacy.redactingHome("/Users/al/Library/Input Methods/Voka.app", home: home),
                       "~/Library/Input Methods/Voka.app")
        XCTAssertEqual(PathPrivacy.redactingHome("/Users/al", home: home), "~")
        XCTAssertEqual(PathPrivacy.redactingHome("not found at /Users/al/a.js (file:///Users/al/b.js:1:2)", home: home),
                       "not found at ~/a.js (file://~/b.js:1:2)")
        // Another account whose name starts the same way is not this home directory.
        XCTAssertEqual(PathPrivacy.redactingHome("/Users/alice/Library", home: home), "/Users/alice/Library")
        XCTAssertEqual(PathPrivacy.redactingHome("/Library/Input Methods/Voka.app", home: home),
                       "/Library/Input Methods/Voka.app")
        XCTAssertEqual(PathPrivacy.redactingHome("/Library/x", home: "/"), "/Library/x")
        XCTAssertEqual(PathPrivacy.redactingHome("", home: home), "")
    }

    func testFlushFailureAlsoKeepsTheRawComposition() throws {
        let (engine, dir) = try failingEngine(failMethod: "flush")
        defer { try? FileManager.default.removeItem(at: dir) }
        let session = try XCTUnwrap(JSSessionDriver(engine: engine))
        let c = context("", selection: NSRange(location: 0, length: 0))
        _ = session.key(KeyInput(key: "a"), context: c)
        XCTAssertEqual(session.flush().commit, "a")
    }

    func testUnavailableEngineLeavesEveryKeyToTheApp() {
        let session = PassthroughSessionDriver()
        let c = context("", selection: NSRange(location: 0, length: 0))
        for key in ["a", "Escape", "Tab", "Backspace", "Enter"] {
            XCTAssertFalse(session.key(KeyInput(key: key), context: c).handled)
        }
    }

    // A second copy of the app (the build folder's) must never start a server: it would replace the
    // running input method's endpoint and leave newly started applications without any input.
    func testOnlyTheInstalledCopyMayServeAndOnlyOnce() {
        let home = "/Users/someone"
        XCTAssertTrue(LaunchGuard.isInstalledLocation(bundlePath: "/Users/someone/Library/Input Methods/Voka.app", home: home))
        XCTAssertTrue(LaunchGuard.isInstalledLocation(bundlePath: "/Library/Input Methods/Voka.app", home: home))
        XCTAssertFalse(LaunchGuard.isInstalledLocation(bundlePath: "/Users/someone/src/voka/macos/build/Voka.app", home: home))
        XCTAssertFalse(LaunchGuard.isInstalledLocation(bundlePath: "/Users/someone/Library/Input Methods/backup/Voka.app", home: home))
        XCTAssertFalse(LaunchGuard.isInstalledLocation(bundlePath: "/Users/someone/Library/Input Methods Old/Voka.app", home: home))

        XCTAssertNil(LaunchGuard.refusal(bundlePath: "/Users/someone/Library/Input Methods/Voka.app", home: home, otherLiveInstances: []))
        XCTAssertNotNil(LaunchGuard.refusal(bundlePath: "/Users/someone/Library/Input Methods/Voka.app", home: home, otherLiveInstances: [4242]))
        XCTAssertNotNil(LaunchGuard.refusal(bundlePath: "/Users/someone/src/voka/macos/build/Voka.app", home: home, otherLiveInstances: []))
    }
}
