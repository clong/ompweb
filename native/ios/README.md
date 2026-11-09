# ompweb for iOS

This iPhone and iPad app opens `https://ompweb.clong.network` in a persistent WebKit view. The portal supplies workspaces, sessions, model controls, file browsing, and the current theme. Native controls provide back/forward navigation, reload, page sharing, app settings, and a connection-error screen.

## Build and run

Open `native/ios/OMPWeb.xcodeproj` in Xcode, select the **OMPWeb** scheme, and choose an iPhone simulator. The project has no third-party Swift dependencies and targets iOS 17 or later.

For a physical iPhone, choose your Apple development team under **Signing & Capabilities**, connect the phone, select it as the run destination, and run the app. Xcode must have permission to manage the app's development provisioning profile. The bundle ID is `network.clong.ompweb.ios`. TestFlight distribution requires a signed archive and a matching App Store Connect app; neither distribution nor App Store review is implied by a simulator build.

```sh
xcodebuild -project native/ios/OMPWeb.xcodeproj -scheme OMPWeb \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath /tmp/ompweb-ios CODE_SIGNING_ALLOWED=NO test
```

Replace the simulator name with one installed on your Mac. The unit tests check exact-origin URL handling, blocked executable/credential URLs, blob export origins, and download filename sanitization.

## Sign-in and connection behavior

Sign in with the existing portal password. The app uses [WebKit's persistent website data store](https://developer.apple.com/documentation/webkit/wkwebsitedatastore), so its login cookies and portal preferences survive relaunches. It does not embed a password, host token, provider key, or a native authentication bypass. Safari and this app have separate website storage.

The phone needs home-network access or a VPN route to the portal. HTTPS certificate validation uses WebKit's default behavior. Failed connections display retry guidance; the app does not bypass certificate errors. Returning to the foreground leaves the current page intact so a draft is not discarded by an automatic reload.

Only the portal's exact HTTPS origin stays in the embedded view. User-activated external HTTP(S) links open in a separate Safari view. Other schemes and credential-bearing URLs are blocked. The app does not inject scripts into the portal or expose a JavaScript-to-native bridge.

**App settings → Sign out on this device** clears this app's cookies, caches, and local portal preferences. It does not sign out another browser or stop remote OMP sessions.

## Files, media, and alerts

Portal downloads use WebKit's authenticated download mechanism and open the iOS share sheet, where you can choose **Save to Files**. Suggested filenames are reduced to a single safe path component. Temporary downloaded files are removed after the share sheet finishes. Interrupted downloads can be retried from the portal.

Web file inputs use the system picker. Camera and microphone access require a user action and iOS permission; the app supplies purpose strings and only permits WebKit's permission prompt for the portal origin. Media capture and file sharing need validation on a physical device.

In-app portal alerts work while the page is open. This version does not register with APNs or deliver background push notifications. OMP continues running on the remote host when iOS suspends the app; iOS does not keep the embedded page's live connection running indefinitely. The existing Home Screen web app remains a separate installation with its own sign-in and notification subscription.

## Validation of this first build

The app compiled for the iPhone simulator and as a signed iOS device archive with Xcode 27.1. Four native unit tests passed on the iPhone 18 Pro simulator. Visual checks confirmed that the live HTTPS portal reaches its password form and that the native settings sheet opens and closes correctly. Authenticated conversations, microphone/camera capture, file exports, and background/foreground reconnects still need an on-device smoke test after sign-in.

## Maintain the native app with the fork

Commit native changes in this directory. UI/theme changes served by the portal appear automatically; native-shell changes require a new iOS build. Building this app does not require restarting the web container or Kali host daemon.

The icon reuses the repository's `public/icon.png`. The app and tests use the repository's MIT license. Do not commit signing keys, provisioning profiles, Xcode user state, archives, or DerivedData.
