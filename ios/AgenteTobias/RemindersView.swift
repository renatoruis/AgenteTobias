import SwiftUI

struct RemindersView: View {
  @Bindable var model: AppModel

  var body: some View {
    NavigationStack {
      Group {
        if model.reminders.isEmpty {
          Text("Sem lembretes.")
            .foregroundStyle(.secondary)
        } else {
          List(model.reminders) { reminder in
            VStack(alignment: .leading, spacing: 4) {
              Text(reminder.title)
                .font(.body.weight(model.focusedReminder == reminder.id ? .bold : .regular))
              Text(model.lisbon(reminder.dueAt))
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .swipeActions {
              Button("Feito") { Task { await model.complete(reminderId: reminder.id) } }
                .tint(.green)
            }
          }
        }
      }
      .navigationTitle("Lembretes")
      .refreshable { await model.loadReminders() }
    }
  }
}
