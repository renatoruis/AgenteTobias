import SwiftUI
import UIKit
import UserNotifications

@main
struct AgenteTobiasApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView(model: model)
        .tint(accent(model.preferences.appearance.accent))
        .preferredColorScheme(scheme(model.preferences.appearance.theme))
        .task { await model.start() }
    }
  }
}

func accent(_ name: String) -> Color {
  switch name {
  case "blue": Color(red: 0.15, green: 0.39, blue: 0.92)
  case "green": Color(red: 0.18, green: 0.49, blue: 0.20)
  case "orange": Color(red: 0.76, green: 0.25, blue: 0.05)
  default: Color(red: 0.06, green: 0.46, blue: 0.43)
  }
}

func scheme(_ theme: String) -> ColorScheme? {
  switch theme {
  case "light": .light
  case "dark": .dark
  default: nil
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    let done = UNNotificationAction(identifier: "done", title: "Feito", options: [])
    let category = UNNotificationCategory(identifier: "REMINDER", actions: [done], intentIdentifiers: [], options: [])
    UNUserNotificationCenter.current().setNotificationCategories([category])
    return true
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    PushBridge.onToken?(token)
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound, .badge])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let id = response.notification.request.content.userInfo["reminderId"] as? String
    if response.actionIdentifier == "done" {
      PushBridge.onDone?(id)
    } else {
      PushBridge.onOpen?(id)
    }
    completionHandler()
  }
}
