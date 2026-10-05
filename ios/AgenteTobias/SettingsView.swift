import AVFoundation
import Photos
import SwiftUI
import UserNotifications

struct SettingsView: View {
  @Bindable var model: AppModel
  @State private var displayName = ""
  @State private var houseName = ""
  @State private var inviteName = ""
  @State private var inviteRole = "adult"
  @State private var microphone = "Ainda não pedido"
  @State private var photos = "Ainda não pedido"
  @State private var notifications = "Ainda não pedido"
  @State private var rateValue = 0.5
  @State private var icon = UserDefaults.standard.string(forKey: "tobias.icon") ?? "default"

  var body: some View {
    NavigationStack {
      Form {
        account
        if model.me?.user.role == "owner" { house }
        appearance
        voice
        alerts
        privacy
      }
      .navigationTitle("Definições")
      .task {
        displayName = model.me?.user.displayName ?? ""
        houseName = model.me?.household.name ?? ""
        rateValue = model.preferences.voice.rate
        await model.reloadSettings()
        refreshPrivacy()
      }
      .onAppear(perform: refreshPrivacy)
      .alert("Convite", isPresented: Binding(get: { model.inviteCode != nil }, set: { if !$0 { model.inviteCode = nil } })) {
        Button("OK") { model.inviteCode = nil }
      } message: {
        Text("Código \(model.inviteCode ?? ""). Mostra-o uma vez.")
      }
    }
  }

  private var account: some View {
    Section("Conta") {
      TextField("Nome", text: $displayName)
        .onSubmit { Task { await model.renameMe(displayName) } }
      LabeledContent("Papel", value: roleName(model.me?.user.role ?? ""))
      Button("Registar passkey neste iPhone") { Task { await model.addPasskey() } }
      Button("Terminar sessão", role: .destructive) { Task { await model.signOut() } }
      if model.sessions.isEmpty {
        Text("Sem outros aparelhos.")
          .foregroundStyle(.secondary)
      }
      ForEach(model.sessions) { session in
        HStack {
          VStack(alignment: .leading) {
            Text(session.deviceName)
            if session.current {
              Text("Este aparelho").font(.footnote).foregroundStyle(.secondary)
            }
          }
          Spacer()
          Button("Revogar") { Task { await model.revokeSession(session.id) } }
        }
      }
    }
  }

  private var house: some View {
    Section("Casa") {
      TextField("Nome da casa", text: $houseName)
        .onSubmit { Task { await model.renameHouse(houseName) } }
      ForEach(model.users) { user in
        LabeledContent(user.displayName, value: roleName(user.role))
      }
      TextField("Nome do convite", text: $inviteName)
      Picker("Papel", selection: $inviteRole) {
        Text("Adulto").tag("adult")
        Text("Membro").tag("member")
        Text("Criança").tag("child")
      }
      Button("Criar convite") {
        Task {
          await model.createInvite(displayName: inviteName, role: inviteRole)
          inviteName = ""
        }
      }
      .disabled(inviteName.trimmingCharacters(in: .whitespaces).isEmpty)
    }
  }

  private var appearance: some View {
    Section("Aparência") {
      Picker("Tema", selection: theme) {
        Text("Sistema").tag("system")
        Text("Claro").tag("light")
        Text("Escuro").tag("dark")
      }
      Picker("Cor", selection: accentName) {
        Text("Teal").tag("teal")
        Text("Azul").tag("blue")
        Text("Verde").tag("green")
        Text("Laranja").tag("orange")
      }
      Picker("Ícone", selection: $icon) {
        Text("Predefinido").tag("default")
        Text("Escuro").tag("AppIconDark")
        Text("Laranja").tag("AppIconOrange")
      }
      .onChange(of: icon) { _, name in
        model.applyIcon(name)
      }
      Text("O tamanho do texto segue o do iPhone.")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }

  private var voice: some View {
    Section("Voz") {
      Toggle("Ler respostas", isOn: speak)
      HStack {
        Text("Velocidade")
        Slider(value: $rateValue, in: 0...1) { editing in
          if !editing {
            var next = model.preferences
            next.voice.rate = rateValue
            Task { await model.savePreferences(next) }
          }
        }
      }
    }
  }

  private var alerts: some View {
    Section("Notificações") {
      Toggle("Lembretes", isOn: remindersOn)
      Toggle("Som", isOn: soundOn)
      Toggle("Distintivo", isOn: badgeOn)
      Toggle("Horas de silêncio", isOn: quietOn)
      if model.preferences.notifications.quietHours != nil {
        DatePicker("De", selection: quietStart, displayedComponents: .hourAndMinute)
        DatePicker("Até", selection: quietEnd, displayedComponents: .hourAndMinute)
      }
      Button("Definições do iPhone") { openSettings() }
    }
  }

  private var privacy: some View {
    Section("Privacidade") {
      LabeledContent("Microfone", value: microphone)
      LabeledContent("Fotos", value: photos)
      LabeledContent("Notificações", value: notifications)
      Button("Abrir Definições") { openSettings() }
    }
  }

  private var theme: Binding<String> {
    Binding(
      get: { model.preferences.appearance.theme },
      set: { value in
        var next = model.preferences
        next.appearance.theme = value
        Task { await model.savePreferences(next) }
      }
    )
  }

  private var accentName: Binding<String> {
    Binding(
      get: { model.preferences.appearance.accent },
      set: { value in
        var next = model.preferences
        next.appearance.accent = value
        Task { await model.savePreferences(next) }
      }
    )
  }

  private var speak: Binding<Bool> {
    Binding(
      get: { model.preferences.voice.speakReplies },
      set: { value in
        var next = model.preferences
        next.voice.speakReplies = value
        Task { await model.savePreferences(next) }
      }
    )
  }

  private var remindersOn: Binding<Bool> {
    Binding(
      get: { model.preferences.notifications.reminders },
      set: { value in
        var next = model.preferences
        next.notifications.reminders = value
        Task {
          await model.savePreferences(next)
          if value { await model.enablePushIfNeeded() }
        }
      }
    )
  }

  private var soundOn: Binding<Bool> {
    Binding(
      get: { model.preferences.notifications.sound },
      set: { value in
        var next = model.preferences
        next.notifications.sound = value
        Task { await model.savePreferences(next) }
      }
    )
  }

  private var badgeOn: Binding<Bool> {
    Binding(
      get: { model.preferences.notifications.badge },
      set: { value in
        var next = model.preferences
        next.notifications.badge = value
        Task { await model.savePreferences(next) }
      }
    )
  }

  private var quietOn: Binding<Bool> {
    Binding(
      get: { model.preferences.notifications.quietHours != nil },
      set: { value in
        var next = model.preferences
        next.notifications.quietHours = value ? (next.notifications.quietHours ?? Preferences.QuietHours(start: "22:00", end: "08:00")) : nil
        Task { await model.savePreferences(next) }
      }
    )
  }

  private var quietStart: Binding<Date> {
    hourBinding(\.start)
  }

  private var quietEnd: Binding<Date> {
    hourBinding(\.end)
  }

  private func hourBinding(_ keyPath: WritableKeyPath<Preferences.QuietHours, String>) -> Binding<Date> {
    Binding(
      get: {
        let value = model.preferences.notifications.quietHours?[keyPath: keyPath] ?? "22:00"
        return date(from: value)
      },
      set: { newDate in
        var next = model.preferences
        guard var quiet = next.notifications.quietHours else { return }
        let formatted = hm(from: newDate)
        if quiet[keyPath: keyPath] == formatted { return }
        quiet[keyPath: keyPath] = formatted
        if quiet.start == quiet.end { return }
        next.notifications.quietHours = quiet
        Task { await model.savePreferences(next) }
      }
    )
  }

  private func date(from value: String) -> Date {
    let parts = value.split(separator: ":")
    var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
    components.hour = Int(parts.first ?? "22")
    components.minute = Int(parts.dropFirst().first ?? "0")
    return Calendar.current.date(from: components) ?? Date()
  }

  private func hm(from date: Date) -> String {
    let components = Calendar.current.dateComponents([.hour, .minute], from: date)
    return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
  }

  private func refreshPrivacy() {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: microphone = "Autorizado"
    case .denied: microphone = "Recusado"
    default: microphone = "Ainda não pedido"
    }
    switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
    case .authorized, .limited: photos = "Autorizado"
    case .denied, .restricted: photos = "Recusado"
    default: photos = "Ainda não pedido"
    }
    Task {
      let settings = await UNUserNotificationCenter.current().notificationSettings()
      let label: String
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral: label = "Autorizado"
      case .denied: label = "Recusado"
      default: label = "Ainda não pedido"
      }
      notifications = label
    }
  }

  private func openSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
  }
}
