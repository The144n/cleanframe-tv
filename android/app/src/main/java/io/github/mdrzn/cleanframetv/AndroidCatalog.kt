package io.github.mdrzn.cleanframetv

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.AdaptiveIconDrawable
import android.media.tv.TvContract
import android.media.tv.TvInputManager
import android.provider.Settings
import android.util.Log
import java.io.File
import java.io.FileOutputStream

/** Reads apps and HDMI inputs from the system and launches them. */
class AndroidCatalog(private val context: Context) {
    private val pm: PackageManager = context.packageManager
    private val prefs = context.getSharedPreferences("cleanframe", Context.MODE_PRIVATE)
    private val iconDir = File(context.filesDir, "icons").apply { mkdirs() }
    @Volatile private var inputIds: Map<String, String> = emptyMap()

    fun entries(): List<CatalogEntry> {
        ensureMonochromeIconCache()
        val apps = Catalog.apps(appCandidates(), context.packageName)
        apps.forEach { exportIcon(it.appId) }
        val inputs = Catalog.inputs(inputCandidates(), inputNames())
        inputIds = inputs.associate { it.entry.appId to it.inputId }
        return apps + inputs.map { it.entry }
    }

    private fun ensureMonochromeIconCache() {
        if (prefs.getInt(ICON_CACHE_VERSION_KEY, 0) == ICON_CACHE_VERSION) return
        iconDir.listFiles()?.forEach { it.delete() }
        prefs.edit().putInt(ICON_CACHE_VERSION_KEY, ICON_CACHE_VERSION).apply()
    }

    private fun appCandidates(): List<AppCandidate> {
        val out = ArrayList<AppCandidate>()
        for ((category, leanback) in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER to true, Intent.CATEGORY_LAUNCHER to false)) {
            val intent = Intent(Intent.ACTION_MAIN).addCategory(category)
            for (info in pm.queryIntentActivities(intent, 0)) {
                val label = info.loadLabel(pm)?.toString() ?: info.activityInfo.packageName
                val system = info.activityInfo.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM != 0
                out += AppCandidate(info.activityInfo.packageName, label, leanback, system)
            }
        }
        return out
    }

    private fun inputCandidates(): List<InputCandidate> {
        val tm = context.getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager ?: return emptyList()
        return try {
            tm.tvInputList.map { info ->
                val custom = info.loadCustomLabel(context)?.toString()?.takeIf { it.isNotBlank() }
                InputCandidate(info.id, info.type, custom ?: info.loadLabel(context)?.toString().orEmpty(), info.parentId)
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "TV inputs unavailable", e); emptyList()
        }
    }

    fun inputNames(): Map<String, String> =
        prefs.all.filterKeys { it.startsWith(NAME_PREFIX) }.mapKeys { it.key.removePrefix(NAME_PREFIX) }.mapValues { it.value.toString() }

    fun saveInputNames(names: Map<String, String>) {
        val editor = prefs.edit()
        names.forEach { (id, name) -> if (name.isBlank()) editor.remove(NAME_PREFIX + id) else editor.putString(NAME_PREFIX + id, name.trim()) }
        editor.apply()
    }

    /** Remote buttons sent to an app or input by [KeyRemapService]: keycode → app or input id. */
    fun buttons(): Map<Int, String> = Catalog.parseButtons(prefs.getString(BUTTONS, null).orEmpty())

    fun saveButtons(buttons: Map<Int, String>) = prefs.edit().putString(BUTTONS, Catalog.buttonsJson(buttons)).apply()

    /** Returns "" on success or a short message for the interface. */
    fun launch(appId: String): String {
        return try {
            val intent = if (appId.startsWith("input.")) {
                val inputId = inputIds[appId] ?: run { entries(); inputIds[appId] } ?: return "This input is not available."
                Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(inputId))
            } else {
                pm.getLeanbackLaunchIntentForPackage(appId) ?: pm.getLaunchIntentForPackage(appId) ?: return "This app is not installed."
            }
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            ""
        } catch (e: Exception) {
            Log.w(TAG, "Launch failed: $appId", e); "The TV could not open this app."
        }
    }

    /**
     * Ends an app's background processes, freeing its memory. Settings' "Force stop" is reserved for
     * system apps; this is the strongest close a launcher may do, and the app is backgrounded by then.
     */
    fun close(appId: String): String {
        if (appId.startsWith("input.")) return "Inputs can’t be closed."
        if (appId == context.packageName) return ""
        return try {
            pm.getPackageInfo(appId, 0)
            (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).killBackgroundProcesses(appId)
            Log.i(TAG, "Closed $appId")
            ""
        } catch (e: PackageManager.NameNotFoundException) {
            "This app is not installed."
        } catch (e: Exception) {
            Log.w(TAG, "Close failed: $appId", e); "The TV could not close this app."
        }
    }

    fun openSettings(): String = start(Intent(Settings.ACTION_SETTINGS))

    fun openAccessibilitySettings(): String = start(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))

    /** Opens another installed home screen (Projectivy first), or the system's home chooser. */
    fun openPreviousLauncher(): String {
        val homes = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
            .map { it.activityInfo }
            .filter { it.packageName != context.packageName && it.packageName !in NOT_LAUNCHERS }
        val target = homes.firstOrNull { it.packageName == PROJECTIVY } ?: homes.firstOrNull()
            ?: return start(Intent(Settings.ACTION_HOME_SETTINGS))
        return start(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setClassName(target.packageName, target.name))
    }

    private fun start(intent: Intent): String = try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); ""
    } catch (e: Exception) {
        Log.w(TAG, "Could not open ${intent.action}", e); "The TV could not open this screen."
    }

    /** Writes a white, transparent app-icon silhouette to filesDir/icons/<package>.png. */
    private fun exportIcon(packageName: String) {
        val file = File(iconDir, "$packageName.png")
        val updated = try { pm.getPackageInfo(packageName, 0).lastUpdateTime } catch (e: Exception) { 0L }
        if (file.isFile && file.lastModified() >= updated) return
        try {
            val appIcon = pm.getApplicationIcon(packageName)
            // Adaptive icons have a separate foreground layer. Use it alone so the coloured
            // background is discarded; legacy icons are tinted as a whole as a best-effort fallback.
            val drawable = if (appIcon is AdaptiveIconDrawable) appIcon.foreground else appIcon
            drawable.mutate().setColorFilter(android.graphics.PorterDuffColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN))
            val size = 128
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(Canvas(bitmap))
            val tmp = File(iconDir, "$packageName.png.tmp")
            FileOutputStream(tmp).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
            tmp.renameTo(file)
        } catch (e: Exception) {
            Log.w(TAG, "No icon for $packageName", e)
        }
    }

    companion object {
        const val TAG = "CleanFrameTV"
        private const val NAME_PREFIX = "inputName."
        private const val BUTTONS = "buttons"
        private const val ICON_CACHE_VERSION_KEY = "iconCacheVersion"
        private const val ICON_CACHE_VERSION = 2
        private const val PROJECTIVY = "com.spocky.projengmenu"
        /** HOME handlers that are not user launchers (setup fallbacks, factory tools). */
        private val NOT_LAUNCHERS = setOf("com.android.tv.settings", "com.android.settings", "com.duokan.factorytest", "com.google.android.tungsten.setupwraith")
    }
}
