import Foundation

struct Me: Decodable, Equatable {
  struct User: Decodable, Equatable {
    var id: String
    var displayName: String
    var role: String
  }

  struct Household: Decodable, Equatable {
    var id: String
    var name: String
    var timezone: String
    var currency: String
    var locale: String
  }

  var user: User
  var household: Household
}

struct MessageResponse: Decodable, Equatable {
  var messageId: String
  var conversationId: String
  var status: String
  var reply: String
  var events: [EventSummary]
}

struct EventSummary: Decodable, Equatable, Identifiable {
  var id: String
  var summary: String
}

struct Reminder: Decodable, Equatable, Identifiable {
  var id: String
  var title: String
  var dueAt: String
  var audience: String
  var eventId: String?
}

struct HouseUser: Decodable, Equatable, Identifiable {
  var id: String
  var displayName: String
  var role: String
}

struct DeviceSession: Decodable, Equatable, Identifiable {
  var id: String
  var deviceName: String
  var current: Bool
}

struct Preferences: Codable, Equatable {
  struct Appearance: Codable, Equatable {
    var theme: String
    var accent: String
  }

  struct Voice: Codable, Equatable {
    var speakReplies: Bool
    var rate: Double
  }

  struct Notifications: Codable, Equatable {
    var reminders: Bool
    var sound: Bool
    var badge: Bool
    var quietHours: QuietHours?
  }

  struct QuietHours: Codable, Equatable {
    var start: String
    var end: String
  }

  var appearance: Appearance
  var voice: Voice
  var notifications: Notifications

  static let standard = Preferences(
    appearance: Appearance(theme: "system", accent: "teal"),
    voice: Voice(speakReplies: false, rate: 0.5),
    notifications: Notifications(reminders: true, sound: true, badge: true, quietHours: nil)
  )
}

struct QueuedMessage: Codable, Equatable {
  var clientMessageId: String
  var text: String
  var queuedAt: Double
  var conversationId: String?
  var correctsEventId: String?
}

enum APIError: Error {
  case http(Int, String)
  case offline
}

struct APIClient {
  static let base = URL(string: "https://tobias.timdevops.com.br")!

  private let session: URLSession
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()

  init() {
    let configuration = URLSessionConfiguration.default
    configuration.httpCookieAcceptPolicy = .always
    configuration.httpShouldSetCookies = true
    configuration.httpCookieStorage = HTTPCookieStorage.shared
    session = URLSession(configuration: configuration)
  }

  func me() async throws -> Me {
    try await get("/api/me")
  }

  func needsBootstrap() async throws -> Bool {
    let body: Setup = try await get("/api/setup")
    return body.needsBootstrap
  }

  func bootstrap(token: String, displayName: String, householdName: String) async throws -> Data {
    try await send(
      "/api/bootstrap",
      method: "POST",
      json: ["token": token, "displayName": displayName, "householdName": householdName]
    )
  }

  func loginOptions() async throws -> Data {
    try await send("/api/auth/login/options", method: "POST")
  }

  func login(credential: [String: Any]) async throws -> Me {
    let data = try await send("/api/auth/login", method: "POST", jsonObject: credential)
    return try decoder.decode(Me.self, from: data)
  }

  func registerOptions() async throws -> Data {
    try await send("/api/auth/register/options", method: "POST")
  }

  func register(credential: [String: Any]) async throws -> Me {
    let data = try await send("/api/auth/register", method: "POST", jsonObject: credential)
    return try decoder.decode(Me.self, from: data)
  }

  func redeemInvite(code: String, displayName: String) async throws -> Data {
    try await send(
      "/api/auth/register",
      method: "POST",
      json: ["inviteCode": code, "displayName": displayName]
    )
  }

  func logout() async throws {
    _ = try await send("/api/auth/logout", method: "POST")
  }

  func postMessage(_ item: QueuedMessage) async throws -> MessageResponse {
    struct Body: Encodable {
      var clientMessageId: String
      var text: String
      var conversationId: String?
      var correctsEventId: String?
    }
    let data = try await send(
      "/api/messages",
      method: "POST",
      body: try encoder.encode(
        Body(
          clientMessageId: item.clientMessageId,
          text: item.text,
          conversationId: item.conversationId,
          correctsEventId: item.correctsEventId
        )
      )
    )
    return try decoder.decode(MessageResponse.self, from: data)
  }

  func confirm(messageId: String, accept: Bool) async throws -> MessageResponse {
    let data = try await send("/api/messages/\(messageId)/confirm", method: "POST", json: ["accept": accept])
    return try decoder.decode(MessageResponse.self, from: data)
  }

  func voidEvent(id: String) async throws {
    _ = try await send("/api/events/\(id)/void", method: "POST")
  }

  func reminders() async throws -> [Reminder] {
    struct Body: Decodable { var reminders: [Reminder] }
    let body: Body = try await get("/api/reminders?status=open")
    return body.reminders
  }

  func done(reminderId: String) async throws {
    _ = try await send("/api/reminders/\(reminderId)/done", method: "POST")
  }

  func speech(file: URL) async throws -> String {
    let audio = try Data(contentsOf: file)
    let boundary = UUID().uuidString
    var body = Data()
    let clientMessageId = UUID().uuidString.lowercased()
    body.append(part("clientMessageId", value: clientMessageId, boundary: boundary))
    body.append(filePart(name: "audio", filename: "fala.m4a", mime: "audio/mp4", data: audio, boundary: boundary))
    body.append(Data("--\(boundary)--\r\n".utf8))
    let data = try await send("/api/speech", method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
    struct Body: Decodable { var transcript: String }
    return try decoder.decode(Body.self, from: data).transcript
  }

  func uploadFile(data: Data, filename: String, mime: String) async throws {
    let boundary = UUID().uuidString
    var body = Data()
    body.append(filePart(name: "file", filename: filename, mime: mime, data: data, boundary: boundary))
    body.append(Data("--\(boundary)--\r\n".utf8))
    _ = try await send("/api/files", method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
  }

  func preferences() async throws -> Preferences {
    try await get("/api/me/preferences")
  }

  func save(preferences: Preferences) async throws -> Preferences {
    let data = try await send("/api/me/preferences", method: "PUT", body: try encoder.encode(preferences))
    return try decoder.decode(Preferences.self, from: data)
  }

  func renameMe(displayName: String) async throws -> Me {
    let data = try await send("/api/me", method: "PATCH", json: ["displayName": displayName])
    return try decoder.decode(Me.self, from: data)
  }

  func renameHouse(name: String) async throws -> Me.Household {
    let data = try await send("/api/household", method: "PATCH", json: ["name": name])
    return try decoder.decode(Me.Household.self, from: data)
  }

  func users() async throws -> [HouseUser] {
    struct Body: Decodable { var users: [HouseUser] }
    let body: Body = try await get("/api/users")
    return body.users
  }

  func sessions() async throws -> [DeviceSession] {
    struct Body: Decodable { var sessions: [DeviceSession] }
    let body: Body = try await get("/api/sessions")
    return body.sessions
  }

  func revoke(sessionId: String) async throws {
    _ = try await send("/api/sessions/\(sessionId)/revoke", method: "POST")
  }

  func invite(displayName: String, role: String) async throws -> String {
    let data = try await send("/api/invites", method: "POST", json: ["displayName": displayName, "role": role])
    struct Body: Decodable { var code: String }
    return try decoder.decode(Body.self, from: data).code
  }

  func registerPush(token: String) async throws {
    let environment: String
    #if DEBUG
      environment = "sandbox"
    #else
      environment = "production"
    #endif
    _ = try await send(
      "/api/devices/current/push",
      method: "PUT",
      json: ["token": token, "environment": environment]
    )
  }

  private struct Setup: Decodable { var needsBootstrap: Bool }

  private func get<T: Decodable>(_ path: String) async throws -> T {
    let data = try await send(path, method: "GET")
    return try decoder.decode(T.self, from: data)
  }

  private func send(_ path: String, method: String, json: [String: Any]) async throws -> Data {
    try await send(path, method: method, body: try JSONSerialization.data(withJSONObject: json), contentType: "application/json")
  }

  private func send(_ path: String, method: String, jsonObject: [String: Any]) async throws -> Data {
    try await send(path, method: method, json: jsonObject)
  }

  private func send(_ path: String, method: String, body: Data? = nil, contentType: String? = nil) async throws -> Data {
    guard let url = URL(string: path, relativeTo: APIClient.base)?.absoluteURL else {
      throw APIError.http(400, "Pedido inválido.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    if let contentType {
      request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    } else if body != nil {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw APIError.offline
    }
    guard let http = response as? HTTPURLResponse else { throw APIError.http(500, "Falhou. Tenta outra vez.") }
    if http.statusCode == 204 { return Data() }
    if (200..<300).contains(http.statusCode) { return data }
    throw APIError.http(http.statusCode, Self.message(in: data))
  }

  private static func message(in data: Data) -> String {
    struct Body: Decodable { struct Item: Decodable { var message: String }; var error: Item }
    if let parsed = try? JSONDecoder().decode(Body.self, from: data), !parsed.error.message.isEmpty {
      return parsed.error.message
    }
    return "Falhou. Tenta outra vez."
  }

  private func part(_ name: String, value: String, boundary: String) -> Data {
    Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8)
  }

  private func filePart(name: String, filename: String, mime: String, data: Data, boundary: String) -> Data {
    var body = Data("--\(boundary)\r\n".utf8)
    body.append(Data("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".utf8))
    body.append(Data("Content-Type: \(mime)\r\n\r\n".utf8))
    body.append(data)
    body.append(Data("\r\n".utf8))
    return body
  }
}
