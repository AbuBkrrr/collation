package ng.com.mysituationroom.observer;

import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;
import com.getcapacitor.BridgeActivity;

// Requests camera, microphone and notification permissions up front so live video streaming works on the
// first try. Location (including background) is requested by the background-geolocation plugin when the
// observer app starts its GPS watcher. The WebView grants getUserMedia once these runtime permissions exist.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        List<String> need = new ArrayList<>();
        String[] want = { Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO };
        for (String p : want) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) need.add(p);
        }
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!need.isEmpty()) ActivityCompat.requestPermissions(this, need.toArray(new String[0]), 9701);
    }
}
