# Configure native iOS push notifications

The iOS app registers its APNs token through the authenticated `/api/notifications/ios` endpoint. The web server sends an APNs alert when its existing session event detector reports completion, a request for input, or an error. This delivery does not require the iPhone app or its WebKit connection to remain running.

## Install an Apple push signing key on the web server

Use an APNs-enabled P-256 `.p8` key from the Apple Developer team that signs the app. An App Store Connect API key is not a substitute. The topic is `network.clong.ompweb.ios`. Prefer a key scoped to this topic and the environment used by the signed app where Apple offers that scope. The current directly installed development build uses the sandbox environment.

Place the key outside the repository and release directories, readable only by the web-service account (or root with a service-readable group). Configure these environment variables in the service's private environment file:

```ini
OMP_WEB_APNS_KEY_FILE=/etc/ompweb/apns.p8
OMP_WEB_APNS_KEY_ID=YOUR_KEY_ID
OMP_WEB_APNS_TEAM_ID=YOUR_TEAM_ID
```

Never embed the key in the iOS app, paste its contents into logs, or commit it. The provider signs ES256 authentication tokens and reuses each for 50 minutes. See [Apple's token authentication documentation](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).

Build and deploy the web release using the fork's documented binary procedure. Restart only the web service. Kali's host daemon continues to own the remote OMP processes.

## Install an app signed for push and enable notifications

The Xcode target includes `aps-environment`. Its `APNS_ENVIRONMENT` build setting controls both that entitlement and the registration sent to the server. Development archives use `development`; use `APNS_ENVIRONMENT=production` when archiving a production/TestFlight build, and verify the exported app's entitlement agrees. An existing wildcard provisioning profile must be replaced by an explicit profile that supports this app's push capability; automatic signing can request it.

After installation, sign in to the portal, open **App settings → Notifications → Enable notifications**, and allow the iOS permission prompt. Registration refreshes on launch, portal load, and foreground entry while notifications are enabled. **Send test notification** reports whether APNs accepted the alert; provider acceptance alone does not prove that iOS displayed it. Verify delivery with the app in the background or the phone locked.

Tapping a notification opens `/?session=<sessionId>`. The app validates the identifier and constructs the URL against its fixed portal origin. It never opens a URL supplied in a push payload. A foreground alert for the conversation currently on screen is suppressed.

## Privacy, expiration, and failure handling

Alerts contain generic wording and an opaque session identifier. Session names, questions, error details, prompts, and results are omitted from the APNs payload. Browser notifications keep their existing preferences and behavior; native push is an independent device subscription.

Registrations are stored in an owner-only `ios-push.db` beneath the web server's agent data directory. The store retains at most 50 devices and expires registrations after 30 days without a refresh. Registration and test/revocation requests require the existing web sign-in; ownership is stored as a hash of that sign-in, not the cookie itself. The API never returns device tokens.

APNs 410 responses and invalid-device-token responses remove the matching registration. A late failure cannot remove a newer token or registration. Connection failures, 429 responses, and 5xx responses retry after 2, 10, and 30 seconds. A collapse identifier limits duplicate alerts for the same event type and conversation. Alerts expire after one hour.

**Disable notifications** removes the server registration. Native **Sign out on this device** waits for that removal before clearing the app's website data. If the portal is unreachable or its login has expired, reconnect/sign in and retry; the app reports the problem instead of silently leaving a subscribed device behind.

## Validation and live delivery

Automated checks cover ES256 signatures, sandbox/production routing, payload privacy, invalid-token cleanup, storage permissions, owner-scoped removal, registration validation, and notification deep links. Existing browser notification tests run alongside these checks.

A complete deployment also requires an APNs signing key, an entitlement-bearing device build, successful authenticated device registration, an APNs-accepted test, and observation of the alert on the physical phone. Keep those live checks separate from mocked transport tests and simulator results when reporting status.
