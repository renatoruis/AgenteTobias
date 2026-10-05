import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct RootView: View {
  @Bindable var model: AppModel

  var body: some View {
    Group {
      switch model.phase {
      case .loading:
        ProgressView("A abrir…")
      case .welcome:
        WelcomeView(model: model)
      case .home:
        TabView(selection: $model.tab) {
          ChatView(model: model)
            .tabItem { Label("Conversas", systemImage: "bubble.left.and.bubble.right") }
            .tag(AppModel.Tab.chat)
          RemindersView(model: model)
            .tabItem { Label("Lembretes", systemImage: "bell") }
            .tag(AppModel.Tab.reminders)
          SettingsView(model: model)
            .tabItem { Label("Definições", systemImage: "gearshape") }
            .tag(AppModel.Tab.settings)
        }
      }
    }
  }
}

struct WelcomeView: View {
  @Bindable var model: AppModel
  @State private var token = ""
  @State private var displayName = ""
  @State private var householdName = "Casa"
  @State private var inviteCode = ""
  @State private var inviteName = ""
  @State private var showInvite = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text("AgenteTobias")
            .font(.largeTitle.bold())
          if let notice = model.notice {
            Text(notice).foregroundStyle(.red)
          }
        }
        if model.needsBootstrap {
          Section("Criar a casa") {
            SecureField("Token", text: $token)
            TextField("O teu nome", text: $displayName)
            TextField("Nome da casa", text: $householdName)
            Button("Criar a casa") {
              Task { await model.createHouse(token: token, displayName: displayName, householdName: householdName) }
            }
            .disabled(model.busy || token.isEmpty || displayName.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        } else {
          Section {
            Button("Entrar") { Task { await model.signIn() } }
              .disabled(model.busy)
            Button("Tenho um convite") { showInvite = true }
          }
        }
      }
      .navigationTitle("AgenteTobias")
      .sheet(isPresented: $showInvite) {
        NavigationStack {
          Form {
            TextField("Código", text: $inviteCode)
              .textInputAutocapitalization(.characters)
            TextField("O teu nome", text: $inviteName)
            Button("Continuar") {
              Task {
                await model.join(code: inviteCode.trimmingCharacters(in: .whitespaces), displayName: inviteName)
                if model.phase == .home { showInvite = false }
              }
            }
            .disabled(model.busy || inviteCode.count < 8 || inviteName.trimmingCharacters(in: .whitespaces).isEmpty)
          }
          .navigationTitle("Convite")
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("Fechar") { showInvite = false }
            }
          }
        }
      }
    }
  }
}

struct ChatView: View {
  @Bindable var model: AppModel
  @State private var photo: PhotosPickerItem?
  @State private var showPDF = false
  @State private var holding = false

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 16) {
            ForEach(model.turns) { turn in
              turnView(turn)
                .id(turn.id)
            }
          }
          .padding()
        }
        .onChange(of: model.turns.count) { _, _ in
          if let last = model.turns.last { proxy.scrollTo(last.id, anchor: .bottom) }
        }
      }
      composer
    }
    .navigationTitle("Conversas")
    .fileImporter(isPresented: $showPDF, allowedContentTypes: [.pdf]) { result in
      if case let .success(url) = result {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        if let data = try? Data(contentsOf: url) {
          Task { await model.attach(data: data, filename: url.lastPathComponent, mime: "application/pdf") }
        }
      }
    }
      .onChange(of: photo) { _, item in
        guard let item else { return }
        Task {
          if let data = try? await item.loadTransferable(type: Data.self),
             let image = UIImage(data: data),
             let jpeg = image.jpegData(compressionQuality: 0.85) {
            await model.attach(data: jpeg, filename: "foto.jpg", mime: "image/jpeg")
          }
          photo = nil
        }
      }
    }
  }

  private var composer: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let transcript = model.transcript {
        TextField("Transcrição", text: Binding(get: { model.transcript ?? "" }, set: { model.transcript = $0 }), axis: .vertical)
          .textFieldStyle(.roundedBorder)
        HStack {
          Button("Registar") { model.registerTranscript() }
          Button("Apagar") { model.transcript = nil }
        }
        .buttonStyle(.bordered)
        .accessibilityHidden(transcript.isEmpty)
      }
      if let notice = model.notice {
        Text(notice)
          .font(.footnote)
          .foregroundStyle(.red)
      }
      HStack(alignment: .bottom, spacing: 12) {
        talkButton
        VStack(alignment: .leading, spacing: 8) {
          TextField(model.correction == nil ? "Escreve à casa" : "Corrigir", text: $model.draft, axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .lineLimit(1...4)
          HStack {
            PhotosPicker(selection: $photo, matching: .images) {
              Image(systemName: "photo")
            }
            .accessibilityLabel("Foto")
            Button {
              showPDF = true
            } label: {
              Image(systemName: "doc")
            }
            .accessibilityLabel("PDF")
            Spacer()
            Button("Enviar") { model.sendDraft() }
              .buttonStyle(.borderedProminent)
              .disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
      }
    }
    .padding()
    .background(.bar)
  }

  private var talkButton: some View {
    Circle()
      .fill(model.talk == .listening ? Color.red : Color.accentColor)
      .frame(width: 72, height: 72)
      .overlay {
        Text(model.talk == .listening ? "A ouvir…" : "Falar")
          .font(.caption.bold())
          .foregroundStyle(.white)
          .multilineTextAlignment(.center)
          .padding(6)
      }
      .accessibilityLabel("Falar")
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { _ in
            if !holding && model.talk == .idle {
              holding = true
              model.beginTalk()
            }
          }
          .onEnded { _ in
            holding = false
            Task { await model.endTalk() }
          }
      )
  }

  @ViewBuilder
  private func turnView(_ turn: ChatTurn) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(turn.text)
        .padding(12)
        .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 16))
        .frame(maxWidth: .infinity, alignment: .trailing)
      if turn.pending {
        bubble("A registar…")
      } else if let error = turn.error {
        bubble(error).foregroundStyle(.red)
      } else if let response = turn.response {
        VStack(alignment: .leading, spacing: 8) {
          Text(response.reply)
          if response.status == "proposal" {
            HStack {
              Button("Gravar") { Task { await model.decide(turn, accept: true) } }
              Button("Não") { Task { await model.decide(turn, accept: false) } }
            }
          }
          if response.status == "interpreted" {
            ForEach(response.events) { event in
              VStack(alignment: .leading, spacing: 4) {
                if response.events.count > 1 {
                  Text(event.summary).font(.footnote)
                }
                if turn.voided.contains(event.id) {
                  Text("Anulado").font(.footnote)
                } else {
                  HStack {
                    Button("Desfazer") { Task { await model.undo(turn, eventId: event.id) } }
                    Button("Editar") { model.edit(turn, eventId: event.id) }
                  }
                }
              }
            }
          }
          if let actionError = turn.actionError {
            Text(actionError).font(.footnote).foregroundStyle(.red)
          }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private func bubble(_ text: String) -> some View {
    Text(text)
      .padding(12)
      .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}
