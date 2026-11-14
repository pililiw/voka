import CoreML
import Foundation

// Compiles a Core ML model package for the app bundle:
//   VokaModelCompiler <model.mlpackage> <output directory>
// writes <output directory>/<model>.mlmodelc. Core ML does the work, so the build needs no Xcode.

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: VokaModelCompiler <model.mlpackage> <output directory>\n".utf8))
    exit(2)
}
let source = URL(fileURLWithPath: arguments[1])
let destination = URL(fileURLWithPath: arguments[2])
    .appendingPathComponent(source.deletingPathExtension().lastPathComponent)
    .appendingPathExtension("mlmodelc")

do {
    let compiled = try MLModel.compileModel(at: source)
    try? FileManager.default.removeItem(at: destination)
    try FileManager.default.moveItem(at: compiled, to: destination)
} catch {
    FileHandle.standardError.write(Data("VokaModelCompiler: \(error.localizedDescription)\n".utf8))
    exit(1)
}
