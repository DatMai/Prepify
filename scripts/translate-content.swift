import Foundation
import Translation

let fileManager = FileManager.default
let projectRoot = URL(fileURLWithPath: fileManager.currentDirectoryPath)
let sourceRoot = projectRoot.appending(path: "content")
let outputRoot = sourceRoot.appending(path: "en")

let requestedFiles = Array(CommandLine.arguments.dropFirst())
let defaultFiles = try fileManager.contentsOfDirectory(atPath: sourceRoot.path)
  .filter { $0.hasSuffix(".json") }
  .sorted()
let files = requestedFiles.isEmpty ? defaultFiles : requestedFiles

let vietnamesePattern = try NSRegularExpression(
  pattern: #"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]"#,
  options: [.caseInsensitive]
)
let unaccentedVietnamesePattern = try NSRegularExpression(
  pattern: #"\b(sang|cai|cac|cho|dung|khong|mot|nhieu|phai|voi|trong|khi|neu|thi|theo|nhu|vao|ngoai|truoc|sau|giua|tren|duoi)\b"#,
  options: [.caseInsensitive]
)
let asciiTokenPattern = try NSRegularExpression(
  pattern: #"(?<![\p{L}\p{M}])[A-Za-z][A-Za-z0-9_.+#/-]*(?![\p{L}\p{M}])"#
)
let technicalTokens = Set([
  "algorithm", "api", "array", "async", "authentication", "authorization", "backend", "batch",
  "block", "boolean", "browser", "buffer", "cache", "callback", "class", "client", "closure",
  "cluster", "code", "compiler", "concurrency", "connection", "const", "container", "cookie", "cpu",
  "database", "declaration", "dependency", "design", "event", "express", "frontend", "function",
  "gateway", "graph", "hash", "heap", "hoisting", "index", "interface", "javascript", "job", "json",
  "jwt", "key", "latency", "library", "load", "lock", "log", "map", "memory", "method", "middleware",
  "module", "network", "node", "object", "operation", "package", "partition", "password", "pattern",
  "permission", "pointer", "pool", "process", "promise", "property", "protocol", "query", "queue",
  "race", "react", "record", "request", "response", "return", "route", "runtime", "scope", "security",
  "server", "session", "socket", "stack", "static", "stream", "string", "system", "table", "task",
  "thread", "token", "transaction", "tree", "type", "typescript", "user", "value", "variable", "vault",
  "worker", "let", "var", "new", "await", "if", "else", "for", "while"
])
let slashCommentPattern = try NSRegularExpression(pattern: #"(?<!:)//"#)
let hashCommentPattern = try NSRegularExpression(pattern: #"\s#\s?"#)
let quotedTextPattern = try NSRegularExpression(pattern: #"([\"'`])([^\"'`]*[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ][^\"'`]*)[\"'`]"#, options: [.caseInsensitive])

func needsTranslation(_ text: String) -> Bool {
  let normalized = normalizeVietnamese(text)
  let range = NSRange(normalized.startIndex..., in: normalized)
  return vietnamesePattern.firstMatch(in: normalized, range: range) != nil
    || unaccentedVietnamesePattern.firstMatch(in: normalized, range: range) != nil
}

// Many legacy code comments were written in Vietnamese without diacritics.
// Restore the common words before sending text to the on-device translator;
// otherwise it mistakes them for English identifiers.
let unaccentedVietnameseReplacements: [(String, String)] = [
  (#"\bvi pham\b"#, "vi phạm"), (#"\btuan thu\b"#, "tuân thủ"),
  (#"\bso sanh\b"#, "so sánh"), (#"\bthay vi\b"#, "thay vì"),
  (#"\bcau hoi\b"#, "câu hỏi"), (#"\bthuc thi\b"#, "thực thi"),
  (#"\bhoat dong\b"#, "hoạt động"), (#"\bgiao tiep\b"#, "giao tiếp"),
  (#"\bchuoi\b"#, "chuỗi"), (#"\bthay doi\b"#, "thay đổi"),
  (#"\bthuc te\b"#, "thực tế"), (#"\bkhong the\b"#, "không thể"),
  (#"\btu dong\b"#, "tự động"), (#"\bthuc hien\b"#, "thực hiện"),
  (#"\bcan\b"#, "cần"), (#"\bduoc\b"#, "được"), (#"\bthi\b"#, "thì"),
  (#"\bla\b"#, "là"),
  (#"\bkhong\b"#, "không"), (#"\bnhung\b"#, "những"),
  (#"\bdung\b"#, "dùng"), (#"\bcho\b"#, "cho"), (#"\bvoi\b"#, "với"),
  (#"\btrong\b"#, "trong"), (#"\bkhi\b"#, "khi"), (#"\bsau\b"#, "sau"),
  (#"\btheo\b"#, "theo"), (#"\btruoc\b"#, "trước"), (#"\bngoai\b"#, "ngoài"),
  (#"\bnhu\b"#, "như"), (#"\bva\b"#, "và"), (#"\bcac\b"#, "các"),
  (#"\bmot\b"#, "một"), (#"\bnhieu\b"#, "nhiều"), (#"\bphai\b"#, "phải"),
  (#"\bvao\b"#, "vào"), (#"\bduoi\b"#, "dưới"), (#"\btren\b"#, "trên"),
  (#"\bgiua\b"#, "giữa")
]

func normalizeVietnamese(_ text: String) -> String {
  unaccentedVietnameseReplacements.reduce(text) { result, replacement in
    result.replacingOccurrences(of: replacement.0, with: replacement.1, options: [.regularExpression, .caseInsensitive])
  }
}

struct ProtectedText {
  let encoded: String
  let terms: [String]

  func restore(_ translated: String) -> String {
    terms.enumerated().reduce(translated) { result, item in
      result.replacingOccurrences(of: "__KEEP\(item.offset)__", with: item.element)
    }
  }
}

func protectTechnicalTerms(_ text: String) -> ProtectedText {
  let fullRange = NSRange(text.startIndex..., in: text)
  let matches = asciiTokenPattern.matches(in: text, range: fullRange).filter { match in
    guard let range = Range(match.range, in: text) else { return false }
    let token = String(text[range])
    let isAllCaps = token.count > 1 && token == token.uppercased() && token != token.lowercased()
    return isAllCaps
      || token.rangeOfCharacter(from: CharacterSet(charactersIn: ".+#/0123456789")) != nil
      || technicalTokens.contains(token.lowercased())
  }
  var encoded = text
  let terms = matches.compactMap { match -> String? in
    guard let range = Range(match.range, in: text) else { return nil }
    return String(text[range])
  }
  for (index, match) in matches.enumerated().reversed() {
    guard let range = Range(match.range, in: encoded) else { continue }
    encoded.replaceSubrange(range, with: "__KEEP\(index)__")
  }
  return ProtectedText(encoded: encoded, terms: terms)
}

func leadingWhitespaceAndBody(_ line: String) -> (String, String) {
  let bodyStart = line.firstIndex(where: { !$0.isWhitespace }) ?? line.endIndex
  return (String(line[..<bodyStart]), String(line[bodyStart...]))
}

func codeSegments(_ body: String) -> [(range: NSRange, text: String)] {
  let fullRange = NSRange(body.startIndex..., in: body)
  let slash = slashCommentPattern.firstMatch(in: body, range: fullRange)
  let hash = hashCommentPattern.firstMatch(in: body, range: fullRange)
  let commentMarker = [slash, hash]
    .compactMap { $0 }
    .min { $0.range.location < $1.range.location }
  let commentStart = commentMarker.map { NSMaxRange($0.range) }
  var ranges: [(NSRange, String)] = []

  if let commentStart, commentStart < fullRange.length {
    let range = NSRange(location: commentStart, length: fullRange.length - commentStart)
    if let swiftRange = Range(range, in: body) {
      let value = String(body[swiftRange])
      if needsTranslation(value) { ranges.append((range, value)) }
    }
  }

  for match in quotedTextPattern.matches(in: body, range: fullRange) {
    let contentRange = match.range(at: 2)
    if let commentStart, contentRange.location >= commentStart { continue }
    if let swiftRange = Range(contentRange, in: body) {
      let value = String(body[swiftRange])
      if needsTranslation(value) { ranges.append((contentRange, value)) }
    }
  }

  if ranges.isEmpty, needsTranslation(body) { return [(fullRange, body)] }
  return ranges
}

func collectCodeText(_ text: String, into strings: inout Set<String>) {
  for line in text.components(separatedBy: "\n") {
    let (_, body) = leadingWhitespaceAndBody(line)
    for segment in codeSegments(body) { strings.insert(segment.text) }
  }
}

func collectTopic(_ topic: [String: Any], into strings: inout Set<String>) {
  for key in ["title", "subtitle"] {
    if let value = topic[key] as? String, needsTranslation(value) { strings.insert(value) }
  }
  guard let sections = topic["sections"] as? [[String: Any]] else { return }
  for section in sections {
    if let name = section["name"] as? String, needsTranslation(name) { strings.insert(name) }
    guard let questions = section["questions"] as? [[String: Any]] else { continue }
    for question in questions {
      if let value = question["q"] as? String, needsTranslation(value) { strings.insert(value) }
      guard let blocks = question["blocks"] as? [[String: Any]] else { continue }
      for block in blocks {
        let type = block["type"] as? String
        if type == "table", let rows = block["rows"] as? [[String]] {
          for value in rows.flatMap({ $0 }) where needsTranslation(value) { strings.insert(value) }
        } else if let value = block["text"] as? String {
          if type == "code" { collectCodeText(value, into: &strings) }
          else if needsTranslation(value) { strings.insert(value) }
        }
      }
    }
  }
}

func collectDaily(_ daily: [String: Any], into strings: inout Set<String>) {
  guard let pool = daily["pool"] as? [[String: Any]] else { return }
  for entry in pool {
    for key in ["prompt", "hint"] {
      if let value = entry[key] as? String, needsTranslation(value) { strings.insert(value) }
    }
    if let blanks = entry["blanks"] as? [String] {
      for value in blanks where needsTranslation(value) { strings.insert(value) }
    }
  }
}

func collectIndex(_ index: [[String: Any]], into strings: inout Set<String>) {
  for entry in index {
    for key in ["title", "subtitle"] {
      if let value = entry[key] as? String, needsTranslation(value) { strings.insert(value) }
    }
  }
}

let session: TranslationSession
if #available(macOS 26.4, *) {
  session = TranslationSession(
    installedSource: Locale.Language(identifier: "vi"),
    target: Locale.Language(identifier: "en"),
    preferredStrategy: .lowLatency
  )
} else {
  session = TranslationSession(
    installedSource: Locale.Language(identifier: "vi"),
    target: Locale.Language(identifier: "en")
  )
}

guard await session.isReady else {
  fatalError("The on-device Vietnamese → English translation model is not installed.")
}

var documents: [String: Any] = [:]
var sourceStrings = Set<String>()

for filename in files {
  let url = sourceRoot.appending(path: filename)
  let data = try Data(contentsOf: url)
  let document = try JSONSerialization.jsonObject(with: data)
  documents[filename] = document

  if filename == "index.json", let index = document as? [[String: Any]] {
    collectIndex(index, into: &sourceStrings)
  } else if filename == "daily.json", let daily = document as? [String: Any] {
    collectDaily(daily, into: &sourceStrings)
  } else if let topic = document as? [String: Any] {
    collectTopic(topic, into: &sourceStrings)
  }
}

let orderedStrings = sourceStrings.sorted()
var translated: [String: String] = [:]
let separator = "<<<PREPIFY_SPLIT_6F2A>>>"
var groups: [[String]] = []
var currentGroup: [String] = []
var currentLength = 0
for value in orderedStrings {
  let addedLength = value.count + (currentGroup.isEmpty ? 0 : separator.count + 2)
  // Translate short passages together. This reduces thousands of individual
  // on-device requests while the sentinel lets us restore each field exactly.
  if !currentGroup.isEmpty && (currentGroup.count >= 4 || currentLength + addedLength > 3_000) {
    groups.append(currentGroup)
    currentGroup = []
    currentLength = 0
  }
  currentGroup.append(value)
  currentLength += addedLength
}
if !currentGroup.isEmpty { groups.append(currentGroup) }

// Keep the on-device translator responsive. Large concurrent batches can
// appear stalled for minutes before returning a single response.
let batchSize = 4
var completedStrings = 0
for start in stride(from: 0, to: groups.count, by: batchSize) {
  let end = min(start + batchSize, groups.count)
  let chunk = Array(groups[start..<end])
  let protectedChunk = chunk.map { $0.map { protectTechnicalTerms(normalizeVietnamese($0)) } }
  let requests = protectedChunk.enumerated().map { offset, group in
    TranslationSession.Request(
      sourceText: group.map(\.encoded).joined(separator: "\n\(separator)\n"),
      clientIdentifier: String(start + offset)
    )
  }
  let responses = try await session.translations(from: requests)
  for response in responses {
    guard let identifier = response.clientIdentifier,
          let absoluteIndex = Int(identifier),
          absoluteIndex >= start,
          absoluteIndex < end else { continue }
    let localIndex = absoluteIndex - start
    let group = chunk[localIndex]
    let protectedGroup = protectedChunk[localIndex]
    let parts = response.targetText.components(separatedBy: separator)
    if parts.count == group.count {
      for (offset, pair) in zip(group, parts).enumerated() {
        translated[pair.0] = protectedGroup[offset]
          .restore(pair.1.trimmingCharacters(in: .whitespacesAndNewlines))
      }
    } else {
      let fallbackRequests = protectedGroup.enumerated().map { offset, source in
        TranslationSession.Request(sourceText: source.encoded, clientIdentifier: String(offset))
      }
      let fallbackResponses = try await session.translations(from: fallbackRequests)
      for fallback in fallbackResponses {
        guard let id = fallback.clientIdentifier, let index = Int(id) else { continue }
        translated[group[index]] = protectedGroup[index].restore(fallback.targetText)
      }
    }
    completedStrings += group.count
  }
  print("Translated \(completedStrings)/\(orderedStrings.count)")
}

func tr(_ value: Any?) -> Any? {
  guard let value = value as? String else { return value }
  return polishEnglish(translated[value] ?? value)
}

func polishEnglish(_ text: String) -> String {
  text
    .replacingOccurrences(of: "Tọc transaction A", with: "Transaction A")
    .replacingOccurrences(
      of: "Câu hỏi kiểm tra SRP: 'If this business rule changes, does this class need to be modified?' Nếu nhiều bộ phận có thể gây ra thay đổi — vi phạm SRP.",
      with: "SRP check: 'If this business rule changes, does this class need to change?' If several teams could cause the change, SRP is violated."
    )
    .replacingOccurrences(
      of: "Câu hỏi hay: **'Which floor does **HTTP operate on? **'**",
      with: "Useful check: **'Which layer does HTTP operate on?'**"
    )
}

func translateCodeText(_ text: String) -> String {
  text.components(separatedBy: "\n").map { line in
    let (leading, body) = leadingWhitespaceAndBody(line)
    var localized = body
    for segment in codeSegments(body).reversed() {
      guard let range = Range(segment.range, in: localized) else { continue }
      localized.replaceSubrange(range, with: polishEnglish(translated[segment.text] ?? segment.text))
    }
    return leading + localized
  }.joined(separator: "\n")
}

func translateTopic(_ topic: [String: Any]) -> [String: Any] {
  var result = topic
  for key in ["title", "subtitle"] { result[key] = tr(topic[key]) }
  guard let sections = topic["sections"] as? [[String: Any]] else { return result }
  result["sections"] = sections.map { section in
    var sectionResult = section
    sectionResult["name"] = tr(section["name"])
    if let questions = section["questions"] as? [[String: Any]] {
      sectionResult["questions"] = questions.map { question in
        var questionResult = question
        questionResult["q"] = tr(question["q"])
        if let blocks = question["blocks"] as? [[String: Any]] {
          questionResult["blocks"] = blocks.map { block in
            var blockResult = block
            let type = block["type"] as? String
            if type == "table", let rows = block["rows"] as? [[String]] {
              blockResult["rows"] = rows.map { row in row.map { translated[$0] ?? $0 } }
            } else if let value = block["text"] as? String {
              blockResult["text"] = type == "code" ? translateCodeText(value) : (translated[value] ?? value)
            }
            return blockResult
          }
        }
        return questionResult
      }
    }
    return sectionResult
  }
  return result
}

func translateDaily(_ daily: [String: Any]) -> [String: Any] {
  var result = daily
  guard let pool = daily["pool"] as? [[String: Any]] else { return result }
  result["pool"] = pool.map { entry in
    var entryResult = entry
    for key in ["prompt", "hint"] { entryResult[key] = tr(entry[key]) }
    if let blanks = entry["blanks"] as? [String] {
      entryResult["blanks"] = blanks.map { translated[$0] ?? $0 }
    }
    return entryResult
  }
  return result
}

func translateIndex(_ index: [[String: Any]]) -> [[String: Any]] {
  index.map { entry in
    var result = entry
    for key in ["title", "subtitle"] { result[key] = tr(entry[key]) }
    return result
  }
}

try fileManager.createDirectory(at: outputRoot, withIntermediateDirectories: true)
for filename in files {
  guard let document = documents[filename] else { continue }
  let localized: Any
  if filename == "index.json", let index = document as? [[String: Any]] {
    localized = translateIndex(index)
  } else if filename == "daily.json", let daily = document as? [String: Any] {
    localized = translateDaily(daily)
  } else if let topic = document as? [String: Any] {
    localized = translateTopic(topic)
  } else {
    localized = document
  }
  let data = try JSONSerialization.data(
    withJSONObject: localized,
    options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
  )
  var output = Data(polishEnglish(String(decoding: data, as: UTF8.self)).utf8)
  output.append(0x0A)
  try output.write(to: outputRoot.appending(path: filename), options: .atomic)
  print("Wrote content/en/\(filename)")
}
