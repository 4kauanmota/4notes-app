package com.kauan.fournotes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** A tela do 4notes no Android: a mesma interface do desktop, dentro de um WebView (Capacitor). */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // O plugin do próprio 4notes (permissão de arquivos, impressão/PDF, abrir links)
        registerPlugin(FourNotesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
