import Foundation
import XCTest
@testable import VokaApp

final class StringsTests: XCTestCase {
    /// The strings of a table by name.
    private func entries(_ table: StringTable) -> [String: String] {
        var result: [String: String] = [:]
        for child in Mirror(reflecting: table).children {
            guard let key = child.label else { continue }
            XCTAssertTrue(child.value is String, "\(key) is not a string")
            result[key] = child.value as? String
        }
        return result
    }

    private func placeholders(_ text: String) -> Int { text.components(separatedBy: "%@").count - 1 }

    private func isCJK(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x2E80...0x9FFF, 0xF900...0xFAFF, 0xFE30...0xFE4F, 0xFF00...0xFFEF, 0x20000...0x3134F: return true
        default: return false
        }
    }

    func testEveryLanguageHasEveryString() {
        let base = entries(.english)
        XCTAssertGreaterThan(base.count, 30)
        XCTAssertEqual(Strings.tables.first?.language, "en", "English is the base language")
        XCTAssertEqual(Set(Strings.tables.map(\.language)).count, Strings.tables.count)
        for (language, table) in Strings.tables {
            let strings = entries(table)
            XCTAssertEqual(Set(strings.keys), Set(base.keys), language)
            for (key, value) in strings {
                XCTAssertFalse(value.trimmingCharacters(in: .whitespaces).isEmpty, "\(language).\(key) is empty")
                XCTAssertEqual(placeholders(value), placeholders(base[key] ?? ""), "\(language).\(key): placeholders differ")
            }
        }
    }

    func testEnglishHasNoChineseText() {
        for (key, value) in entries(.english) {
            XCTAssertFalse(value.unicodeScalars.contains(where: isCJK), "english.\(key): \(value)")
        }
    }

    func testChineseIsTranslated() {
        let english = entries(.english)
        // Names and symbols may be the same in both; sentences may not.
        for (key, value) in entries(.simplifiedChinese) where (english[key] ?? "").contains(" ") {
            XCTAssertNotEqual(value, english[key], "simplifiedChinese.\(key) is not translated")
        }
    }

    func testTheInterfaceLanguageIsTheFirstPreferredOneThatHasATable() {
        func space(_ languages: [String]) -> String { Strings.table(for: languages).space }
        XCTAssertEqual(space(["en-US"]), "Space")
        XCTAssertEqual(space(["zh-Hans-CN", "en"]), "空格")
        XCTAssertEqual(space(["zh"]), "空格")
        XCTAssertEqual(space(["en-GB", "zh-Hans"]), "Space")
        XCTAssertEqual(space(["fr-FR", "zh-Hans", "en"]), "空格")
        XCTAssertEqual(space(["fr-FR", "ja"]), "Space")
        XCTAssertEqual(space([]), "Space")
    }

    func testValuesAreInserted() {
        XCTAssertEqual(StringTable.english.corrected(to: "receive"), "Corrected to receive")
        XCTAssertEqual(StringTable.simplifiedChinese.restore("recieve"), "恢复 recieve")
        XCTAssertEqual(StringTable.english.version("1.0.0"), "Version 1.0.0")
        XCTAssertEqual(StringTable.english.modelStatusLatency(12.4), "Local AI 12 ms")
        XCTAssertTrue(StringTable.english.localAIDetail("Model ready.").hasSuffix("word. Model ready."))
    }
}
