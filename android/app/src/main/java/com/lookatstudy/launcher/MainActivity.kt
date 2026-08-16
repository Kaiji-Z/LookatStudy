package com.lookatstudy.launcher

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/**
 * 引导器主屏:三态
 *  1. Termux 未装 → 用内置 termux.apk(res/raw,构建时下载)拉起系统安装器
 *  2. Termux 已装 → 一键复制安装命令 + 跳 Termux 粘贴执行(装 Node + 下载便携包 + 启动服务)
 *  3. 服务已启动 → 「打开 LookatStudy」走 WebUiActivity(Custom Tab 到 127.0.0.1:17890)
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var actionButton: Button
    private lateinit var openWebButton: Button

    companion object {
        private const val TAG = "LookatStudy"
        private const val TERMUX_PACKAGE = "com.termux"
        private const val INSTALL_CMD =
            "pkg install curl unzip -y && mkdir -p ~/lookatstudy && cd ~/lookatstudy && " +
                "curl -fsSL -o ls.zip https://github.com/Kaiji-Z/LookatStudy/releases/latest/download/lookatstudy-mobile.zip && " +
                "unzip -o ls.zip && bash install-termux.sh"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        actionButton = findViewById(R.id.actionButton)
        openWebButton = findViewById(R.id.openWebButton)

        openWebButton.setOnClickListener {
            startActivity(Intent(this, WebUiActivity::class.java))
        }

        updateState()
    }

    override fun onResume() {
        super.onResume()
        updateState()
    }

    private fun updateState() {
        openWebButton.isEnabled = isTermuxInstalled()
        if (isTermuxInstalled()) {
            showTermuxReady()
        } else {
            showInstallTermux()
        }
    }

    private fun isTermuxInstalled(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(TERMUX_PACKAGE, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
            }
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun showInstallTermux() {
        statusText.text = "// termux: 未安装"
        statusText.setTextColor(android.graphics.Color.parseColor("#8FB99B"))
        actionButton.text = "安装 Termux(内置安装包)"
        actionButton.setOnClickListener { installBundledTermux() }
    }

    private fun installBundledTermux() {
        actionButton.isEnabled = false
        actionButton.text = "正在准备…"

        Thread {
            try {
                val apkFile = File(cacheDir, "termux.apk")
                resources.openRawResource(R.raw.termux).use { input ->
                    FileOutputStream(apkFile).use { output -> input.copyTo(output) }
                }

                runOnUiThread {
                    statusText.text = "// 正在安装 Termux…"
                    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    try {
                        startActivity(intent)
                    } catch (e: Exception) {
                        Toast.makeText(this, "无法启动安装器: ${e.message}", Toast.LENGTH_LONG).show()
                        Log.e(TAG, "startActivity failed", e)
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    statusText.text = "// 安装失败: ${e.message}"
                    Toast.makeText(this, "安装失败: ${e.message}", Toast.LENGTH_LONG).show()
                    Log.e(TAG, "installBundledTermux failed", e)
                }
            } finally {
                runOnUiThread {
                    actionButton.isEnabled = true
                    actionButton.text = "安装 Termux(内置安装包)"
                }
            }
        }.start()
    }

    private fun showTermuxReady() {
        statusText.text = "// termux: 就绪"
        statusText.setTextColor(android.graphics.Color.parseColor("#58CC02"))
        actionButton.text = "复制安装命令并打开 Termux"
        actionButton.setOnClickListener {
            copyToClipboard()
            launchTermux()
        }
    }

    private fun copyToClipboard() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("LookatStudy", INSTALL_CMD))
        Toast.makeText(this, "安装命令已复制，请在 Termux 里长按粘贴并回车", Toast.LENGTH_LONG).show()
    }

    private fun launchTermux() {
        try {
            val intent = packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }
        } catch (_: Exception) {
        }
    }
}
