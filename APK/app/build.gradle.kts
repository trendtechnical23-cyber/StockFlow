plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    // Add the Google services Gradle plugin
    id("com.google.gms.google-services")
    // Add Kotlin Symbol Processing (KSP) for Room
    id("com.google.devtools.ksp") version "2.0.20-1.0.25"
}

android {
    namespace = "com.trendstock.trendmobility"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.trendstock.trendmobility"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
    buildFeatures {
        compose = true
    }
}

dependencies {

    // Import the Firebase BoM
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    
    // Firebase Auth
    implementation("com.google.firebase:firebase-auth")
    
    // Firebase Firestore (Cloud Firestore)
    implementation("com.google.firebase:firebase-firestore")
    
    // Firebase Cloud Messaging (FCM)
    implementation("com.google.firebase:firebase-messaging")
    
    // Firebase Realtime Database (kept for compatibility)
    implementation("com.google.firebase:firebase-database")
    
    // Room Database
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    
    // HTTP client for API calls
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    
    // Navigation
    implementation("androidx.navigation:navigation-compose:2.8.3")
    
    // LiveData Compose
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