import AVFoundation
import Foundation
import Network
import Observation
import UIKit
import UserNotifications

struct ChatTurn: Identifiable, Equatable {
  var clientMessageId: String
  var text: String
  var pending: Bool
  var response: MessageResponse?
  var error: String?
  var actionError: String?
  var voided: Set<String>
  var id: String { clientMessageId }
}

enum TalkState: Equatable {
  case idle
  case listening
}

@MainActor
@Observable
final class AppModel {
  var phase: Phase = .loading
  var me: Me?
  var needsBootstrap = false
  var preferences = Preferences.standard
  var turns: [ChatTurn] = []
  var reminders: [Reminder] = []
  var users: [HouseUser] = []
  var sessions: [DeviceSession] = []
  var tab = Tab.chat
  var focusedReminder: String?
  var draft = ""
  var correction: String?
  var transcript: String?
  var notice: String?
  var talk = TalkState.idle
  var inviteCode: String?
  var busy = false

  enum Phase: Equatable { case loading, welcome, home }
  enum Tab: String, Hashable { case chat, reminders, settings }

  private let api = APIClient()
  private let speaker = AVSpeechSynthesizer()
  private var recorder: AVAudioRecorder?
  private var talkStarted: Date?
  private var talkTask: Task<Void, Never>?
  private var endingTalk = false
  private let monitor = NWPathMonitor()
  private let outboxKey = "tobias.outbox"
  private var conversationId: String?

  func start() async {
    wirePush()
    applyIcon(UserDefaults.standard.string(forKey: "tobias.icon") ?? "default", persist: false)
    monitor.pathUpdateHandler = { [weak self] path in
      guard path.status == .satisfied else { return }
      Task { await self?.flushOutbox() }
    }
    monitor.start(queue: DispatchQueue(label: "tobias.network"))
    await refreshSession()
  }

  func refreshSession() async {
    do {
      me = try await api.me()
      preferences = (try? await api.preferences()) ?? .standard
      phase = .home
      await reloadLists()
      await flushOutbox()
      await enablePushIfNeeded()
    } catch let error as APIError {
      if case .http(401, _) = error {
        phase = .welcome
        needsBootstrap = (try? await api.needsBootstrap()) ?? false
      } else {
        notice = text(of: error)
        if me == nil { phase = .welcome }
      }
    } catch {
      if me == nil { phase = .welcome }
    }
  }

  func createHouse(token: String, displayName: String, householdName: String) async {
    busy = true
    defer { busy = false }
    do {
      let data = try await api.bootstrap(token: token, displayName: displayName, householdName: householdName)
      guard let options = WebAuthnJSON.options(in: data) else { throw APIError.http(400, "Pedido inválido.") }
      let credential = try await Passkey.register(options: options)
      me = try await api.register(credential: credential)
      preferences = (try? await api.preferences()) ?? .standard
      phase = .home
      await reloadLists()
    } catch is PasskeyError {
      notice = nil
    } catch {
      notice = text(of: error)
    }
  }

  func signIn() async {
    busy = true
    defer { busy = false }
    do {
      let data = try await api.loginOptions()
      guard let options = WebAuthnJSON.options(in: data) else { throw APIError.http(400, "Pedido inválido.") }
      let credential = try await Passkey.assert(options: options)
      me = try await api.login(credential: credential)
      preferences = (try? await api.preferences()) ?? .standard
      phase = .home
      await reloadLists()
      await enablePushIfNeeded()
    } catch is PasskeyError {
      notice = nil
    } catch {
      notice = text(of: error)
    }
  }

  func join(code: String, displayName: String) async {
    busy = true
    defer { busy = false }
    do {
      let data = try await api.redeemInvite(code: code, displayName: displayName)
      guard let options = WebAuthnJSON.options(in: data) else { throw APIError.http(400, "Pedido inválido.") }
      let credential = try await Passkey.register(options: options)
      me = try await api.register(credential: credential)
      preferences = (try? await api.preferences()) ?? .standard
      phase = .home
      await reloadLists()
    } catch is PasskeyError {
      notice = nil
    } catch {
      notice = text(of: error)
    }
  }

  func addPasskey() async {
    do {
      let data = try await api.registerOptions()
      guard let options = WebAuthnJSON.options(in: data) else { throw APIError.http(400, "Pedido inválido.") }
      let credential = try await Passkey.register(options: options)
      me = try await api.register(credential: credential)
      notice = "Passkey registada neste iPhone."
    } catch is PasskeyError {
      notice = nil
    } catch {
      notice = text(of: error)
    }
  }

  func signOut() async {
    _ = try? await api.logout()
    me = nil
    turns = []
    phase = .welcome
    needsBootstrap = (try? await api.needsBootstrap()) ?? false
  }

  func sendDraft() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    let item = QueuedMessage(
      clientMessageId: UUID().uuidString.lowercased(),
      text: text,
      queuedAt: Date().timeIntervalSince1970,
      conversationId: conversationId,
      correctsEventId: correction
    )
    draft = ""
    correction = nil
    tab = .chat
    append(item)
    Task { await deliver(item) }
  }

  func registerTranscript() {
    guard let transcript else { return }
    draft = transcript
    self.transcript = nil
    sendDraft()
  }

  func beginTalk() {
    speaker.stopSpeaking(at: .immediate)
    notice = nil
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("fala-\(UUID().uuidString).m4a")
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
      try session.setActive(true)
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
      ]
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      recorder.record()
      self.recorder = recorder
      talkStarted = Date()
      talk = .listening
    } catch {
      notice = "O microfone não está disponível."
      return
    }
    talkTask?.cancel()
    talkTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(60))
      guard !Task.isCancelled else { return }
      await self?.endTalk()
    }
  }

  func endTalk() async {
    talkTask?.cancel()
    guard talk == .listening, !endingTalk else { return }
    endingTalk = true
    defer { endingTalk = false }
    let started = talkStarted ?? Date()
    recorder?.stop()
    let url = recorder?.url
    recorder = nil
    talk = .idle
    let seconds = Date().timeIntervalSince(started)
    guard let url else { return }
    if seconds < 0.4 {
      notice = "Segura um pouco mais."
      try? FileManager.default.removeItem(at: url)
      return
    }
    do {
      transcript = try await api.speech(file: url)
    } catch {
      notice = text(of: error)
    }
    try? FileManager.default.removeItem(at: url)
  }

  func decide(_ turn: ChatTurn, accept: Bool) async {
    guard let messageId = turn.response?.messageId else { return }
    do {
      let response = try await api.confirm(messageId: messageId, accept: accept)
      replace(turn.clientMessageId, response: response, error: nil)
      speak(response.reply)
    } catch {
      setActionError(turn.clientMessageId, text(of: error))
    }
  }

  func undo(_ turn: ChatTurn, eventId: String) async {
    do {
      try await api.voidEvent(id: eventId)
      if let index = turns.firstIndex(where: { $0.clientMessageId == turn.clientMessageId }) {
        turns[index].voided.insert(eventId)
      }
    } catch {
      setActionError(turn.clientMessageId, text(of: error))
    }
  }

  func edit(_ turn: ChatTurn, eventId: String) {
    draft = turn.text
    correction = eventId
    tab = .chat
  }

  func attach(data: Data, filename: String, mime: String) async {
    if data.count > 10 * 1024 * 1024 {
      notice = "O ficheiro ultrapassa 10 MB."
      return
    }
    do {
      try await api.uploadFile(data: data, filename: filename, mime: mime)
      notice = "Ficheiro guardado."
    } catch {
      notice = text(of: error)
    }
  }

  func loadReminders() async {
    do {
      reminders = try await api.reminders()
    } catch {
      notice = text(of: error)
    }
  }

  func complete(reminderId: String) async {
    do {
      try await api.done(reminderId: reminderId)
      reminders.removeAll { $0.id == reminderId }
    } catch {
      notice = text(of: error)
    }
  }

  func openReminder(_ id: String) {
    focusedReminder = id
    tab = .reminders
  }

  func savePreferences(_ next: Preferences) async {
    let previous = preferences
    preferences = next
    do {
      preferences = try await api.save(preferences: next)
    } catch {
      preferences = previous
      notice = text(of: error)
    }
  }

  func renameMe(_ name: String) async {
    do {
      me = try await api.renameMe(displayName: name)
    } catch {
      notice = text(of: error)
    }
  }

  func renameHouse(_ name: String) async {
    do {
      let household = try await api.renameHouse(name: name)
      me?.household = household
    } catch {
      notice = text(of: error)
    }
  }

  func createInvite(displayName: String, role: String) async {
    do {
      inviteCode = try await api.invite(displayName: displayName, role: role)
      users = (try? await api.users()) ?? users
    } catch {
      notice = text(of: error)
    }
  }

  func revokeSession(_ id: String) async {
    do {
      try await api.revoke(sessionId: id)
      if sessions.first(where: { $0.id == id })?.current == true {
        await signOut()
        return
      }
      sessions = (try? await api.sessions()) ?? []
    } catch {
      notice = text(of: error)
    }
  }

  func reloadSettings() async {
    users = (try? await api.users()) ?? []
    sessions = (try? await api.sessions()) ?? []
    if let fresh = try? await api.preferences() { preferences = fresh }
  }

  func enablePushIfNeeded() async {
    guard preferences.notifications.reminders else { return }
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    let granted: Bool
    if settings.authorizationStatus == .notDetermined {
      granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    } else {
      granted = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }
    if granted {
      UIApplication.shared.registerForRemoteNotifications()
    }
  }

  func registerPushToken(_ token: String) async {
    do {
      try await api.registerPush(token: token)
    } catch {
      notice = text(of: error)
    }
  }

  func applyIcon(_ name: String, persist: Bool = true) {
    let alternate: String? = name == "default" ? nil : name
    if UIApplication.shared.alternateIconName != alternate {
      UIApplication.shared.setAlternateIconName(alternate)
    }
    if persist {
      UserDefaults.standard.set(name, forKey: "tobias.icon")
    }
  }

  func lisbon(_ iso: String) -> String {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let plain = ISO8601DateFormatter()
    guard let date = withFraction.date(from: iso) ?? plain.date(from: iso) else { return iso }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "pt-PT")
    formatter.timeZone = TimeZone(identifier: "Europe/Lisbon")
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: date)
  }

  private func reloadLists() async {
    await loadReminders()
    await reloadSettings()
  }

  private func append(_ item: QueuedMessage) {
    turns.append(
      ChatTurn(
        clientMessageId: item.clientMessageId,
        text: item.text,
        pending: true,
        response: nil,
        error: nil,
        actionError: nil,
        voided: []
      )
    )
  }

  private func deliver(_ item: QueuedMessage) async {
    do {
      let response = try await api.postMessage(item)
      conversationId = response.conversationId
      replace(item.clientMessageId, response: response, error: nil)
      speak(response.reply)
      removeOutbox(item.clientMessageId)
    } catch let error as APIError {
      if case .offline = error {
        enqueue(item)
      } else if case .http(401, _) = error {
        replace(item.clientMessageId, response: nil, error: text(of: error))
        phase = .welcome
      } else {
        replace(item.clientMessageId, response: nil, error: text(of: error))
      }
    } catch {
      enqueue(item)
    }
  }

  private func flushOutbox() async {
    for item in loadOutbox() {
      if !turns.contains(where: { $0.clientMessageId == item.clientMessageId }) {
        append(item)
      }
      await deliver(item)
    }
  }

  private func enqueue(_ item: QueuedMessage) {
    var items = loadOutbox().filter { $0.clientMessageId != item.clientMessageId }
    items.append(item)
    if let data = try? JSONEncoder().encode(items) {
      UserDefaults.standard.set(data, forKey: outboxKey)
    }
  }

  private func removeOutbox(_ id: String) {
    let items = loadOutbox().filter { $0.clientMessageId != id }
    if let data = try? JSONEncoder().encode(items) {
      UserDefaults.standard.set(data, forKey: outboxKey)
    }
  }

  private func loadOutbox() -> [QueuedMessage] {
    guard let data = UserDefaults.standard.data(forKey: outboxKey) else { return [] }
    return (try? JSONDecoder().decode([QueuedMessage].self, from: data)) ?? []
  }

  private func replace(_ id: String, response: MessageResponse?, error: String?) {
    guard let index = turns.firstIndex(where: { $0.clientMessageId == id }) else { return }
    turns[index].pending = false
    turns[index].response = response
    turns[index].error = error
    turns[index].actionError = nil
  }

  private func setActionError(_ id: String, _ message: String) {
    guard let index = turns.firstIndex(where: { $0.clientMessageId == id }) else { return }
    turns[index].actionError = message
  }

  private func speak(_ reply: String) {
    guard preferences.voice.speakReplies, !reply.isEmpty else { return }
    let utterance = AVSpeechUtterance(string: reply)
    utterance.voice = AVSpeechSynthesisVoice(language: "pt-PT")
    utterance.rate = Float(min(max(preferences.voice.rate, 0), 1))
    speaker.speak(utterance)
  }

  private func wirePush() {
    PushBridge.onToken = { [weak self] token in
      Task { await self?.registerPushToken(token) }
    }
    PushBridge.onOpen = { [weak self] id in
      guard let id else { return }
      self?.openReminder(id)
    }
    PushBridge.onDone = { [weak self] id in
      guard let id else { return }
      Task { await self?.complete(reminderId: id) }
    }
  }

  private func text(of error: Error) -> String {
    if let api = error as? APIError {
      switch api {
      case .offline:
        return "Sem rede."
      case .http(_, let message):
        return message
      }
    }
    if error is PasskeyError { return "A passkey falhou." }
    return "Falhou. Tenta outra vez."
  }
}

enum PushBridge {
  static var onToken: ((String) -> Void)?
  static var onOpen: ((String?) -> Void)?
  static var onDone: ((String?) -> Void)?
}

func roleName(_ role: String) -> String {
  switch role {
  case "owner": "Dono"
  case "adult": "Adulto"
  case "member": "Membro"
  case "child": "Criança"
  default: role
  }
}
