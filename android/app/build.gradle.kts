import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "eu.nebendahl.manhunt"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "eu.nebendahl.manhunt"
        minSdk = 26
        targetSdk = 35
        // Beim Release-Build setzt der Forgejo-Workflow beides aus dem Git-Tag (z. B. v2.3.4 -> 2.3.4 / 2030004).
        // Lokal gilt der Grundwert; der automatische Tag auf GitHub nimmt "major.minor" von hier.
        versionCode = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 2070000
        versionName = (project.findProperty("versionName") as String?) ?: "2.7"
        // Server-Adresse der Manhunt-Website
        buildConfigField("String", "BASE_URL", "\"https://manhunt.nebendahl.eu\"")
        // Hier fragt die App beim Öffnen nach einer neueren Version (Forgejo-Releases, öffentlich)
        buildConfigField("String", "UPDATE_URL", "\"https://git.nebendahl.eu/api/v1/repos/Mrcoolgamer-Inc/manhunt/releases/latest\"")
    }

    // Fester Signierschlüssel, damit neue APKs über alte installiert werden können.
    // Quelle: keystore.properties (lokal, nicht im Git) oder Umgebungsvariablen MANHUNT_KEYSTORE* (CI).
    // Fehlt beides, wird mit dem normalen Debug-Schlüssel signiert.
    val keyProps = Properties().apply {
        val f = rootProject.file("keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    fun keyProp(name: String, env: String): String? = keyProps.getProperty(name) ?: System.getenv(env)
    val storePath = keyProp("storeFile", "MANHUNT_KEYSTORE")
    val manhuntSigning = if (storePath != null && rootProject.file(storePath).exists()) {
        signingConfigs.create("manhunt") {
            storeFile = rootProject.file(storePath)
            storePassword = keyProp("storePassword", "MANHUNT_KEYSTORE_PASSWORD")
            keyAlias = keyProp("keyAlias", "MANHUNT_KEY_ALIAS") ?: "manhunt"
            keyPassword = keyProp("keyPassword", "MANHUNT_KEY_PASSWORD") ?: storePassword
        }
    } else null

    buildTypes {
        debug {
            if (manhuntSigning != null) signingConfig = manhuntSigning
        }
        release {
            isMinifyEnabled = false
            signingConfig = manhuntSigning ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.osmdroid:osmdroid-android:6.1.20")

    testImplementation("junit:junit:4.13.2")
    // Echte org.json-Implementierung für JVM-Tests (android.jar enthält nur Stubs)
    testImplementation("org.json:json:20240303")
}
