import AuthenticationServices
import Foundation
import UIKit

enum PasskeyError: Error {
  case cancelled
  case failed
}

enum Passkey {
  private static var active: Coordinator?

  static func assert(options: [String: Any]) async throws -> [String: Any] {
    guard
      let challenge = options["challenge"] as? String,
      let challengeData = Base64URL.decode(challenge),
      let rpId = options["rpId"] as? String
    else { throw PasskeyError.failed }
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
    let request = provider.createCredentialAssertionRequest(challenge: challengeData)
    return try await perform(request) { authorization in
      guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
        throw PasskeyError.failed
      }
      let id = Base64URL.encode(credential.credentialID)
      var response: [String: Any] = [
        "clientDataJSON": Base64URL.encode(credential.rawClientDataJSON),
        "authenticatorData": Base64URL.encode(credential.rawAuthenticatorData),
        "signature": Base64URL.encode(credential.signature),
      ]
      if let handle = credential.userID {
        response["userHandle"] = Base64URL.encode(handle)
      }
      return [
        "id": id,
        "rawId": id,
        "type": "public-key",
        "clientExtensionResults": [String: Any](),
        "response": response,
      ]
    }
  }

  static func register(options: [String: Any]) async throws -> [String: Any] {
    guard
      let challenge = options["challenge"] as? String,
      let challengeData = Base64URL.decode(challenge),
      let rp = options["rp"] as? [String: Any],
      let rpId = rp["id"] as? String,
      let user = options["user"] as? [String: Any],
      let userID = user["id"] as? String,
      let userData = Base64URL.decode(userID),
      let name = user["name"] as? String
    else { throw PasskeyError.failed }
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
    let request = provider.createCredentialRegistrationRequest(challenge: challengeData, name: name, userID: userData)
    if let displayName = user["displayName"] as? String {
      request.displayName = displayName
    }
    if #available(iOS 17.4, *), let excluded = options["excludeCredentials"] as? [[String: Any]] {
      request.excludedCredentials = excluded.compactMap { item in
        guard let id = item["id"] as? String, let data = Base64URL.decode(id) else { return nil }
        return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: data)
      }
    }
    return try await perform(request) { authorization in
      guard
        let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
        let attestation = credential.rawAttestationObject
      else { throw PasskeyError.failed }
      let id = Base64URL.encode(credential.credentialID)
      return [
        "id": id,
        "rawId": id,
        "type": "public-key",
        "clientExtensionResults": [String: Any](),
        "response": [
          "clientDataJSON": Base64URL.encode(credential.rawClientDataJSON),
          "attestationObject": Base64URL.encode(attestation),
        ],
      ]
    }
  }

  private static func perform(
    _ request: ASAuthorizationRequest,
    map: @escaping (ASAuthorization) throws -> [String: Any]
  ) async throws -> [String: Any] {
    try await withCheckedThrowingContinuation { continuation in
      let coordinator = Coordinator(map: map) { result in
        active = nil
        continuation.resume(with: result)
      }
      active = coordinator
      let controller = ASAuthorizationController(authorizationRequests: [request])
      controller.delegate = coordinator
      controller.presentationContextProvider = coordinator
      coordinator.controller = controller
      controller.performRequests()
    }
  }
}

private final class Coordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  var controller: ASAuthorizationController?
  private let map: (ASAuthorization) throws -> [String: Any]
  private let finish: (Result<[String: Any], Error>) -> Void
  private var resumed = false

  init(map: @escaping (ASAuthorization) throws -> [String: Any], finish: @escaping (Result<[String: Any], Error>) -> Void) {
    self.map = map
    self.finish = finish
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard !resumed else { return }
    resumed = true
    do {
      finish(.success(try map(authorization)))
    } catch {
      finish(.failure(error))
    }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    guard !resumed else { return }
    resumed = true
    let code = (error as NSError).code
    if code == ASAuthorizationError.canceled.rawValue {
      finish(.failure(PasskeyError.cancelled))
    } else {
      finish(.failure(error))
    }
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    return scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first ?? ASPresentationAnchor()
  }
}

enum Base64URL {
  static func decode(_ value: String) -> Data? {
    var text = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let padding = (4 - text.count % 4) % 4
    text += String(repeating: "=", count: padding)
    return Data(base64Encoded: text)
  }

  static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

enum WebAuthnJSON {
  static func object(from data: Data) -> [String: Any]? {
    (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  static func options(in data: Data) -> [String: Any]? {
    guard let object = object(from: data) else { return nil }
    if let nested = object["options"] as? [String: Any] { return nested }
    if object["challenge"] != nil { return object }
    return nil
  }
}
