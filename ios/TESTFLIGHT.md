# TestFlight

Bundle: `br.com.timdevops.tobias`. iOS 17 ou mais recente.

1. Conta Apple Developer e app no App Store Connect com este bundle.
2. No Xcode, Signing & Capabilities: a tua equipa. O projeto já tem assinatura automática.
3. Segredos do Worker, sem os pôr no git: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_AUTH_KEY` (o ficheiro `.p8`). A var `APNS_BUNDLE_ID` já é `br.com.timdevops.tobias`.
4. O `apple-app-site-association` usa o Team ID. Sem ele, a passkey não associa.
5. Archive com o scheme AgenteTobias, configuração Release. Product → Archive → Distribute App → TestFlight.
6. Debug no Xcode regista o push em sandbox. O TestFlight usa production.
7. Privacidade já declarada: microfone, fotos, notificações. `ITSAppUsesNonExemptEncryption` está a falso.
8. No aparelho: notificações, passkey, e um lembrete com `due_at` já passado para ver o aviso. O cron corre de 5 em 5 minutos.
