package com.kauan.fournotes;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * O que o 4notes precisa do Android e o Capacitor não traz pronto
 * (a interface usa pelo arquivo app/lib/mobile/native.ts):
 *
 *  - storageInfo / requestStorageAccess: o "Acesso a todos os arquivos" — o workspace fica
 *    numa pasta escolhida por você no armazenamento interno;
 *  - printHtml: imprime a nota (a impressora "Salvar como PDF" do Android gera o PDF);
 *  - openUrl: abre um link no navegador.
 */
@CapacitorPlugin(
    name = "FourNotes",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class FourNotesPlugin extends Plugin {

    /** O WebView da impressão precisa continuar existindo enquanto o Android imprime. */
    private WebView printView;

    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return getPermissionState("storage") == PermissionState.GRANTED;
    }

    private void resolveAccess(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasStorageAccess());
        call.resolve(result);
    }

    @PluginMethod
    public void storageInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("root", Environment.getExternalStorageDirectory().getAbsolutePath());
        result.put("granted", hasStorageAccess());
        call.resolve(result);
    }

    @PluginMethod
    public void requestStorageAccess(PluginCall call) {
        if (hasStorageAccess()) {
            resolveAccess(call);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // A tela do Android com a opção do 4notes (ou, se não existir, a lista de apps)
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            try {
                startActivityForResult(call, intent, "storageAccessResult");
            } catch (ActivityNotFoundException error) {
                startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "storageAccessResult");
            }
        } else {
            requestPermissionForAlias("storage", call, "storagePermissionResult");
        }
    }

    @ActivityCallback
    private void storageAccessResult(PluginCall call, ActivityResult result) {
        resolveAccess(call);
    }

    @PermissionCallback
    private void storagePermissionResult(PluginCall call) {
        resolveAccess(call);
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String name = call.getString("name", "4notes");
        if (html == null || html.isEmpty()) {
            call.reject("Conteúdo vazio.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getActivity());
            view.getSettings().setJavaScriptEnabled(false);
            view.setWebViewClient(new WebViewClient() {
                private boolean printed = false;

                @Override
                public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                    // A nota é só para imprimir: nenhum link abre aqui
                    return true;
                }

                @Override
                public void onPageFinished(WebView webView, String url) {
                    if (printed) return;
                    printed = true;
                    try {
                        PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                        PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
                        PrintAttributes attributes = new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                        manager.print(name, adapter, attributes);
                        call.resolve();
                    } catch (Exception error) {
                        call.reject("Não foi possível abrir a impressão: " + error.getMessage());
                    }
                }
            });
            printView = view;
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:"))) {
            call.reject("Link não permitido.");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("Nenhum app instalado abre esse link.");
        }
    }
}
