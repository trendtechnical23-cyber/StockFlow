plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    // Google services plugin — kept for Firebase Cloud Messaging (FCM) ONLY.
    // Firebase Auth / Firestore / Realtime Database have been removed.
    id("com.google.gms.google-services")
    id("com.google.devtools.ksp") version "2.0.20-1.0.25"
}

android {
    namespace = "com.trendstock.trendmobility"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.trendstock.trendmobility"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "2.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // ── Supabase config ───────────────────────────────────────────────────
        // Fill in your Supabase project URL and anon key.
        // Find them at: Supabase Dashboard → Project Settings → API
        // DO NOT use the service_role key here — anon key only.
        buildConfigField("String", "SUPABASE_URL",      "\"https://bfocuklqupxpelzvfjzk.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"sb_publishable_W8ASXvv6EhmSaOQ7hJmQwQ_OYn6f-vE\"")

        // ── Backend URL ───────────────────────────────────────────────────────
        buildConfigField("String", "BACKEND_URL", "\"https://stockflow-production-3876.up.railway.app/api/\"")
    }

    buildFeatures {
        compose     = true
        buildConfig = true   // required for BuildConfig fields above
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {

    // ── Firebase ──────────────────────────────────────────────────────────────
    // KEPT: Firebase Cloud Messaging (FCM) — push notifications.
    // REMOVED: firebase-auth, firebase-firestore, firebase-database.
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging")

    // ── Room (local inventory cache — unchanged) ───────────────────────────
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // ── Retrofit + OkHttp (backend + Supabase auth REST) ──────────────────
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // ── Jetpack ────────────────────────────────────────────────────────────
    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("androidx.compose.runtime:runtime-livedata:1.7.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)
}
