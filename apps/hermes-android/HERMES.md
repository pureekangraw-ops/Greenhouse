# HERMES v0.1 (Android)

HERMES reuses the Android application and on-device inference/server implementation
from [OlliteRT](https://github.com/NightMean/OlliteRT), pinned here to commit
`b49ca6616b62704992187a28c84a7ec40127d818`. It uses the existing LiteRT-LM runtime,
Ktor HTTP server, model manager, server controls, status screen, and request logs;
it does not add a second inference engine or a second API client.

The HERMES flavor is a separate Android package (`com.ollitert.llm.server.hermes`)
so it can be installed alongside OlliteRT without replacing it. Its HTTP listener
is forcibly clamped to `127.0.0.1`, including values received from persisted
settings or server configuration writes. The network-binding controls are hidden.
Automatic app-update checks, background model-allowlist refreshes, and Home
Assistant remote-control settings are disabled for this flavor.

Inference is on-device and does not require a cloud service. Model downloads and
catalog refreshes are separate setup operations; the installed app can import a
`.litertlm` model through Android's file picker. Android app sandboxes are separate,
so an existing OlliteRT model is not automatically visible to HERMES. HERMES does
not schedule background network refreshes; opening the model catalog or explicitly
downloading a model may still use the network.

## Build

Requirements follow the upstream project: JDK 21, Android SDK API 36, and its
Gradle wrapper.

```bash
cd apps/hermes-android
./gradlew :app:testHermesDebugUnitTest
./gradlew :app:assembleHermesDebug
```

The APK is emitted under `app/build/outputs/apk/hermes/debug/`. It is a debug-signed
artifact intended for local installation and device acceptance, not production
distribution.

## Provenance and license

This derivative retains the upstream Apache-2.0 `LICENSE` and source notices.
HERMES-specific changes are limited to the product flavor, display identity,
loopback enforcement, disabling automatic background update/catalog refresh, and
their tests. Upstream names remain in source/package identifiers where changing
them would create unnecessary churn.