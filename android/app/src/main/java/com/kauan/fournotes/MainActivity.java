package com.kauan.fournotes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Tela do app Android: o WebView do Capacitor com a mesma interface do desktop.
 * Os plugins próprios do 4notes são registrados antes do onCreate:
 *  - FourNotesPlugin: permissão de arquivos, impressão (PDF) e abrir links;
 *  - UpdaterPlugin: baixar e instalar as atualizações (GitHub Releases).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FourNotesPlugin.class);
        registerPlugin(UpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
