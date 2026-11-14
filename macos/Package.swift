// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VokaIME",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "VokaCore", targets: ["VokaCore"]),
        .executable(name: "VokaIME", targets: ["VokaApp"]),
        .executable(name: "VokaLauncher", targets: ["VokaLauncher"])
    ],
    targets: [
        .target(
            name: "VokaCore",
            path: "Sources/VokaCore",
            linkerSettings: [.linkedFramework("JavaScriptCore"), .linkedFramework("CoreML")]
        ),
        .executableTarget(
            name: "VokaApp",
            dependencies: ["VokaCore"],
            path: "Sources/VokaApp",
            linkerSettings: [
                .linkedFramework("Cocoa"),
                .linkedFramework("InputMethodKit"),
                .linkedFramework("Carbon")
            ]
        ),
        .executableTarget(
            name: "VokaLauncher",
            path: "Sources/VokaLauncher",
            linkerSettings: [.linkedFramework("Cocoa")]
        ),
        .executableTarget(
            name: "VokaModelCompiler",
            path: "Sources/VokaModelCompiler",
            linkerSettings: [.linkedFramework("CoreML")]
        ),
        .testTarget(
            name: "VokaCoreTests",
            dependencies: ["VokaCore"],
            path: "Tests/VokaCoreTests"
        ),
        .testTarget(
            name: "VokaAppTests",
            dependencies: ["VokaApp", "VokaCore"],
            path: "Tests/VokaAppTests"
        )
    ],
    swiftLanguageVersions: [.v5]
)
