plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.lookatstudy.launcher"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.lookatstudy.launcher"
        minSdk = 26
        targetSdk = 34
        versionCode = 3
        versionName = "0.11.0"
    }

    aaptOptions {
        // 内置 termux.apk 原样打进包(解压安装用),不要被 aapt 二次压缩
        noCompress("apk")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // v1 引导器走侧载,用 debug 签名即可安装(无需正式签名配置)
            signingConfig = signingConfigs.getByName("debug")
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
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
}
