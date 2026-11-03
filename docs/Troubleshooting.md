# Troubleshooting

Back to [[Home]] · see also [[Development Setup]], [[Testing]]

## Log prefixes (dev-server output)
| Prefix | Comes from | Healthy example |
| --- | --- | --- |
| `[host]` | [[Host Server]] / loopback [[Transports]] | `network type=WIFI ip=192.168.1.84` then `listening on 0.0.0.0:8787` |
| `[ble]` | [[Discovery]] | host: `GATT server open`, `advertising`; joiner: `found host …`, `read … "Name's Huddle" ip:port 1/4` |
| `[sync]` | [[Playback and Drift Correction]] | `start drift -40ms, start lead now 230ms` |

## Common problems
| Symptom | Cause / fix |
| --- | --- |
| `Cannot find native module 'ExpoLinking'` (or another module) | The phone has an **old build**. Install the latest development build. Reloading isn't enough ([[Development Setup#When to rebuild]]) |
| No nearby sessions | Is Bluetooth on (`adapter state: poweredOff`)? Is the permission granted? Is the host app in the **foreground**? Or use *Join with address instead* |
| Host shows a mobile-data warning | The host isn't on Wi-Fi, or is sharing a hotspot. Use Wi-Fi, or have joiners enter the hotspot address manually ([[Host Server#Startup]]) |
| Host on a port other than 8787 | An old native server from a JS reload still holds the port. Harmless: the real port is advertised ([[Host Server#Startup]]) |
| Joiner can't connect | Both phones must be on the same Wi-Fi network. Guest networks often isolate devices |
| "The session is full." | 4 members max ([[Session Protocol#Limits and constants]]) |
| Play does nothing for a few seconds | Someone is still buffering ([[Readiness and Pending Play]]) |
| Brief audio dropouts on iPhone | Frequent playback-rate changes. Look for repeated `[sync] nudging rate` lines ([[Playback and Drift Correction#The iOS dropout lesson]]) |
| Echo between phones | Watch `[sync]` drift. Persistent large drift means [[Clock Sync]] is struggling: check Wi-Fi quality |
| Android dev client QR scanner hangs | Use **Enter URL manually** with `http://<PC IP>:8081` |
| Dev server started on 8082 | An old Metro still holds 8081. Stop it and restart on 8081, or the phones will load stale code |
