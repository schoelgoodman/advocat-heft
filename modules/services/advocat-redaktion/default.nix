# Die Redaktion läuft als eigener Container aus dem Image von advocat.
# Sie schreibt nur Inhalt und Fassungen. Die Seite setzt der Container advocat,
# der die Änderung am Inhalt bemerkt. So schreibt nur ein Prozess nach site/.
{...}: {
  flake.modules.nixos.advocat-redaktion = {
    config,
    lib,
    ...
  }:
    with lib; let
      cfg = config.neo.services.advocat-redaktion;
      seite = config.neo.services.advocat;
      appdata = "${config.neo.core.volumes.appdata}/advocat";
      domain = config.neo.services.swag.domain or null;
    in {
      config = mkIf cfg.enabled {
        assertions = [
          {
            assertion = seite.enabled;
            message = "neo.services.advocat-redaktion braucht neo.services.advocat. Den Dienst Advocat Finanz einschalten.";
          }
        ];

        # Wants statt Requires: ein Neustart von advocat-image startet die Redaktion
        # nicht mit. Ein neues Image ändert diese Unit ohnehin.
        systemd.services.docker-advocat-redaktion = {
          wants = ["advocat-image.service"];
          after = ["advocat-image.service"];
          preStart = lib.neo.mkEnsureDirs config [
            appdata
            "${appdata}/content"
            "${appdata}/site"
            "${appdata}/anfragen"
            "${appdata}/chat"
          ];
        };

        virtualisation.oci-containers.containers.advocat-redaktion = {
          environment = {
            TZ = config.neo.core.timeZone;
            NODE_ENV = "production";
            ROLLE = "redaktion";
            CONTENT_DIR = "/content";
            SITE_DIR = "/site";
            ANFRAGEN_DIR = "/anfragen";
            CHAT_DIR = "/chat";
            XAI_MODEL = cfg.assistent.modell;
            PUBLIC_URL = optionalString (domain != null) "https://${seite.subdomain}.${domain}";
            PORT = "4321";
          }
          // optionalAttrs (cfg.assistent.xaiApiKey != "") {
            XAI_API_KEY = cfg.assistent.xaiApiKey;
          }
          # Designwünsche aus dem Assistenten gehen an denselben Telegram-Chat wie die Anfragen.
          // optionalAttrs (seite.telegram.botToken != "" && seite.telegram.chatId != "") {
            TELEGRAM_BOT_TOKEN = seite.telegram.botToken;
            TELEGRAM_CHAT_ID = seite.telegram.chatId;
          };
          image = cfg.containers.advocat-redaktion;
          user = "${toString config.neo.core.uid}:${toString config.neo.core.gid}";
          autoStart = true;
          volumes = [
            "${appdata}/content:/content"
            # Nur lesen: Schriften und Bilder für den Editor.
            "${appdata}/site:/site:ro"
            # Die Anfragen schreibt die Seite. Die Redaktion schreibt daneben nur _status.json.
            "${appdata}/anfragen:/anfragen"
            # Der Verlauf des Assistenten. Nicht im Inhalts-Git.
            "${appdata}/chat:/chat"
          ];
          networks = ["internal"];
        };
      };
    };
}
