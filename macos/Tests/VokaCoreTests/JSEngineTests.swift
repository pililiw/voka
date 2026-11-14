import Foundation
import XCTest
@testable import VokaCore

/// Runs `macos/Resources/engine.js` in the system JavaScriptCore and replays `tests/data/parity.json`
/// (key sequences and the document V8 produced), so a difference means JavaScriptCore disagrees with V8.
final class JSEngineTests: XCTestCase {
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()

    private static let engine: JSEngine = {
        let e = JSEngine()
        e.load(
            scriptURL: repoRoot.appendingPathComponent("macos/Resources/engine.js"),
            dictURL: repoRoot.appendingPathComponent("data/dict.json")
        )
        return e
    }()

    private struct ParityItem: Decodable {
        let before: String
        let keys: String
        let expect: String
    }

    private static let keyNames: [String: String] = [
        "⌫": "Backspace", "⏎": "Enter", "⇥": "Tab", "⎋": "Escape",
        "→": "ArrowRight", "←": "ArrowLeft", "↓": "ArrowDown", "↑": "ArrowUp"
    ]

    private func engineOrSkip() throws -> JSEngine {
        let e = Self.engine
        if !e.isReady, e.lastError.contains("not found") {
            throw XCTSkip("\(e.lastError) - run `node scripts/build-engine-bundle.mjs` first (npm run macos:test does)")
        }
        XCTAssertTrue(e.isReady, e.lastError)
        return e
    }

    /// Type `keys` into a document that starts as `before`; returns the document (+ ⟦preedit⟧ if still composing).
    private func type(_ e: JSEngine, _ keys: String, before: String) -> String {
        let sid = e.newSession()
        defer { e.endSession(sid) }
        let doc = NSMutableString(string: before)
        var preedit = ""
        let chars = keys.unicodeScalars.map(String.init)
        var i = 0
        while i < chars.count {
            var key = Self.keyNames[chars[i]] ?? chars[i]
            var alt = false
            if chars[i] == "⌥", i + 1 < chars.count {
                alt = true
                i += 1
                key = chars[i]
            }
            i += 1
            guard let v = e.key(sid, key: key, shift: false, alt: alt, before: doc as String) else {
                XCTFail("bridge failure: \(e.lastError)")
                return doc as String
            }
            if v.handled {
                if v.deleteBack > 0 {
                    let n = min(v.deleteBack, doc.length)
                    doc.deleteCharacters(in: NSRange(location: doc.length - n, length: n))
                }
                if let c = v.commit { doc.append(c) }
            }
            if (!v.handled || v.passThrough) && !alt {
                if key.unicodeScalars.count == 1 {
                    doc.append(key)
                } else if key == "Backspace" {
                    if doc.length > 0 { doc.deleteCharacters(in: NSRange(location: doc.length - 1, length: 1)) }
                } else if key == "Enter" {
                    doc.append("\n")
                } else if key == "Tab" {
                    doc.append("\t")
                }
            }
            preedit = v.preedit
        }
        return (doc as String) + (preedit.isEmpty ? "" : "⟦\(preedit)⟧")
    }

    func testLoadsWithProtectionTable() throws {
        let e = try engineOrSkip()
        XCTAssertGreaterThan(e.info?.words ?? 0, 30000)
        XCTAssertEqual(e.info?.knownTokens, true, "known-word protection table must self-check OK in JavaScriptCore")
    }

    func testParityWithV8() throws {
        let e = try engineOrSkip()
        let data = try Data(contentsOf: Self.repoRoot.appendingPathComponent("tests/data/parity.json"))
        let items = try JSONDecoder().decode([ParityItem].self, from: data)
        XCTAssertGreaterThan(items.count, 500)
        var bad: [String] = []
        var keys = 0
        let t0 = Date()
        for it in items {
            keys += it.keys.unicodeScalars.count
            let got = type(e, it.keys, before: it.before)
            if got != it.expect {
                bad.append("keys=\(it.keys.prefix(60)) expect=\(it.expect.suffix(60)) got=\(got.suffix(60))")
            }
        }
        let ms = Date().timeIntervalSince(t0) * 1000
        print(String(format: "JSC parity: %d/%d identical · %d keys · %.2f ms/key", items.count - bad.count, items.count, keys, ms / Double(max(1, keys))))
        XCTAssertTrue(bad.isEmpty, "\(bad.count) mismatches:\n" + bad.prefix(10).joined(separator: "\n"))
        XCTAssertEqual(e.engineLastError(), "")
    }

    func testViewDrivesTheCandidateWindow() throws {
        let e = try engineOrSkip()
        let sid = e.newSession()
        var v = HostView.unhandled
        for ch in "recom" { v = try XCTUnwrap(e.key(sid, key: String(ch), shift: false, alt: false, before: "I ")) }
        XCTAssertTrue(v.handled)
        XCTAssertEqual(v.preedit, "recom")
        XCTAssertTrue(v.show)
        XCTAssertNil(v.commit)
        XCTAssertGreaterThanOrEqual(v.tabIndex, 0)
        XCTAssertTrue(v.candidates[v.tabIndex].word.hasPrefix("recom"))
        // Tab takes the suggestion.
        v = try XCTUnwrap(e.key(sid, key: "Tab", shift: false, alt: false, before: "I "))
        XCTAssertEqual(v.preedit, "")
        XCTAssertFalse(v.show)
        XCTAssertTrue(v.commit?.hasPrefix("recom") ?? false)
        XCTAssertGreaterThan(v.commit?.count ?? 0, "recom ".count)
    }

    func testOptionsDecideWhetherDigitsPick() throws {
        let e = try engineOrSkip()
        defer { e.setOptions(json: #"{"numberKeysPick": true}"#) }

        /// Type `recom`, then the digit of the Tab candidate; returns that candidate and the view after the digit.
        func typeDigit(_ sid: Int) throws -> (word: String, view: HostView) {
            _ = e.flush(sid)
            var v = HostView.unhandled
            for ch in "recom" { v = try XCTUnwrap(e.key(sid, key: String(ch), shift: false, alt: false, before: "I ")) }
            let index = v.tabIndex
            guard index >= 0, index < 9, index != v.selected else { throw XCTSkip("no candidate a digit could pick") }
            let after = try XCTUnwrap(e.key(sid, key: String(index + 1), shift: false, alt: false, before: "I "))
            return (v.candidates[index].word, after)
        }

        let existing = e.newSession()
        defer { e.endSession(existing) }
        var typed = try typeDigit(existing)
        XCTAssertEqual(typed.view.commit, typed.word + " ", "digits pick by default")

        // The option reaches sessions that exist and sessions made afterwards.
        e.setOptions(json: #"{"numberKeysPick": false}"#)
        typed = try typeDigit(existing)
        XCTAssertNotEqual(typed.view.commit, typed.word + " ")
        let fresh = e.newSession()
        defer { e.endSession(fresh) }
        typed = try typeDigit(fresh)
        XCTAssertNotEqual(typed.view.commit, typed.word + " ")
        XCTAssertTrue(typed.view.preedit.hasPrefix("recom"), "the digit is typed, the word goes on")

        e.setOptions(json: #"{"numberKeysPick": true}"#)
        typed = try typeDigit(fresh)
        XCTAssertEqual(typed.view.commit, typed.word + " ")
        XCTAssertEqual(e.engineLastError(), "")
    }

    func testFlushKeepsWhatWasTyped() throws {
        let e = try engineOrSkip()
        let sid = e.newSession()
        for ch in "teh" { _ = e.key(sid, key: String(ch), shift: false, alt: false, before: "") }
        let v = try XCTUnwrap(e.flush(sid))
        XCTAssertEqual(v.commit, "teh")
        XCTAssertEqual(v.preedit, "")
        XCTAssertNil(try XCTUnwrap(e.flush(sid)).commit)
    }

    func testSpaceCorrectsAndEnterKeepsWhatWasTyped() throws {
        let e = try engineOrSkip()
        XCTAssertEqual(type(e, "teh ", before: ""), "the ")
        XCTAssertEqual(type(e, "hello⏎", before: ""), "hello")
        XCTAssertEqual(type(e, "hello⏎⏎", before: ""), "hello\n")
    }

    func testPunctuationCommitsRestoreAndSelection() throws {
        let e = try engineOrSkip()
        for delimiter in [".", ",", "。", "，"] {
            let sid = e.newSession()
            defer { e.endSession(sid) }
            for c in "bhvr" { _ = e.key(sid, key: String(c), shift: false, alt: false, before: "") }
            let v = try XCTUnwrap(e.key(sid, key: delimiter, shift: false, alt: false, before: ""))
            let suffix = ["。": ".", "，": ","][delimiter] ?? delimiter
            XCTAssertEqual(v.commit, "behavior" + suffix)
            XCTAssertEqual(v.correction?.original, "bhvr" + suffix)
            let restored = try XCTUnwrap(e.restore(sid, before: v.commit!))
            XCTAssertEqual(restored.commit, "bhvr" + suffix)
        }
        let sid = e.newSession()
        defer { e.endSession(sid) }
        for c in "manag" { _ = e.key(sid, key: String(c), shift: false, alt: false, before: "") }
        _ = e.key(sid, key: "ArrowDown", shift: false, alt: false, before: "")
        let selected = try XCTUnwrap(e.key(sid, key: "ArrowDown", shift: false, alt: false, before: ""))
        XCTAssertEqual(selected.tabIndex, selected.selected)
        XCTAssertEqual(selected.explicitSelection, true)
        _ = e.key(sid, key: "e", shift: false, alt: false, before: "")
        XCTAssertEqual(e.key(sid, key: " ", shift: false, alt: false, before: "")?.commit, "manage ")
        XCTAssertEqual(e.key(sid, key: "Backspace", shift: false, alt: false, before: "manage ")?.handled, false)
    }
}
