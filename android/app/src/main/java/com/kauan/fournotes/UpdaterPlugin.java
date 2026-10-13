package com.kauan.fournotes;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Atualizações do 4notes no Android (app/lib/mobile/updates.ts): baixa o APK da versão
 * nova (GitHub Releases) para o cache do app e abre o instalador do Android.
 *
 *  - download({ url, fileName }) → { path }  — avisa o andamento em "downloadProgress";
 *  - install({ path }) → { status: "installing" | "permission" } — sem a permissão de
 *    instalar apps, abre a tela do Android para permitir (e devolve "permission").
 *
 * O Android só aceita o APK novo se ele for assinado com a mesma chave do instalado.
 */
@CapacitorPlugin(name = "FourNotesUpdater")
public class UpdaterPlugin extends Plugin {

    private static final int MAX_REDIRECTS = 6;

    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Endereço da atualização inválido.");
            return;
        }
        String name = call.getString("fileName", "4notes-update.apk").replaceAll("[^A-Za-z0-9._-]", "_");
        if (!name.toLowerCase().endsWith(".apk")) name = name + ".apk";
        final String fileName = name;

        new Thread(() -> {
            File dir = updatesDir();
            // Só fica a versão que está sendo baixada
            File[] old = dir.listFiles();
            if (old != null) for (File file : old) if (!file.getName().equals(fileName)) file.delete();
            File partial = new File(dir, fileName + ".part");
            HttpURLConnection connection = null;
            try {
                String address = url;
                for (int hop = 0; ; hop++) {
                    connection = (HttpURLConnection) new URL(address).openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(30000);
                    connection.setRequestProperty("User-Agent", "4notes");
                    int code = connection.getResponseCode();
                    if (code >= 300 && code < 400 && hop < MAX_REDIRECTS) {
                        String location = connection.getHeaderField("Location");
                        connection.disconnect();
                        if (location == null) throw new Exception("redirecionamento sem destino");
                        address = new URL(new URL(address), location).toString();
                        continue;
                    }
                    if (code < 200 || code >= 300) throw new Exception("o servidor respondeu " + code);
                    break;
                }
                long total = connection.getContentLength();
                long received = 0;
                int lastPercent = -1;
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        received += read;
                        if (total > 0) {
                            int percent = (int) (received * 100 / total);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                JSObject progress = new JSObject();
                                progress.put("percent", percent);
                                notifyListeners("downloadProgress", progress);
                            }
                        }
                    }
                }
                if (total > 0 && received != total) throw new Exception("o download veio incompleto");
                File target = new File(dir, fileName);
                if (target.exists()) target.delete();
                if (!partial.renameTo(target)) throw new Exception("não foi possível guardar o arquivo");
                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                call.resolve(result);
            } catch (Exception error) {
                partial.delete();
                call.reject("Não foi possível baixar a atualização: " + error.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        File file = path == null ? null : new File(path);
        try {
            // Só instala o que foi baixado para a pasta de atualizações do app
            if (file == null || !file.isFile() || !file.getCanonicalFile().getParentFile().equals(updatesDir().getCanonicalFile())) {
                call.reject("O arquivo da atualização não foi encontrado. Tente de novo.");
                return;
            }
        } catch (Exception error) {
            call.reject("O arquivo da atualização não foi encontrado. Tente de novo.");
            return;
        }

        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            // Primeira vez: o Android pede que você permita o 4notes instalar apps
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            result.put("status", "permission");
            call.resolve(result);
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("status", "installing");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível abrir o instalador: " + error.getMessage());
        }
    }
}
