# Startet den Node-Prozess. Inhalt und HTML liegen auf dem Volume.
{withSystem, ...}: {
  flake.modules.nixos.advocat = {
    config,
    lib,
    pkgs,
    ...
  }:
    with lib; let
      cfg = config.neo.services.advocat;
      appdata = "${config.neo.core.volumes.appdata}/advocat";
      image = withSystem pkgs.stdenv.hostPlatform.system ({config, ...}: config.packages.advocat-heft-image);
      docker = "${config.virtualisation.docker.package}/bin/docker";
    in {
      config = mkIf cfg.enabled {
        # Lädt das Nix-Image in Docker, bevor der Container startet. Der Tag ist der
        # Image-Hash: ein neuer Bau wird einmal geladen, ein unveränderter übersprungen.
        # Ein neues Image ändert diese Unit, also läuft sie beim Switch vor docker-advocat.
        systemd.services.advocat-image = {
          description = "Advocat-Image in Docker laden";
          after = ["docker.service" "docker.socket"];
          requires = ["docker.service"];
          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = true;
          };
          script = ''
            if ! ${docker} image inspect ${image.imageRefUnsafe} >/dev/null 2>&1; then
              ${image.copyToDockerDaemon}/bin/copy-to-docker-daemon
            fi
            # Alte Bauten entfernen. Den vom laufenden Container verweigert Docker,
            # der geht beim nächsten Lauf.
            ${docker} image ls ${image.imageName} --format '{{.Repository}}:{{.Tag}}' \
              | grep -vxF ${image.imageRefUnsafe} \
              | xargs -r ${docker} rmi 2>/dev/null || true
          '';
        };

        systemd.services.docker-advocat = {
          requires = ["advocat-image.service"];
          after = ["advocat-image.service"];
          preStart = lib.neo.mkEnsureDirs config [
            appdata
            "${appdata}/content"
            "${appdata}/site"
            "${appdata}/anfragen"
          ];
        };

        virtualisation.oci-containers.containers.advocat = {
          environment = {
            TZ = config.neo.core.timeZone;
            NODE_ENV = "production";
            # Nur die Seite. Die Redaktion ist der Container von advocat-redaktion.
            ROLLE = "seite";
            CONTENT_DIR = "/content";
            SITE_DIR = "/site";
            ANFRAGEN_DIR = "/anfragen";
            TELEGRAM_BOT_TOKEN = cfg.telegram.botToken;
            TELEGRAM_CHAT_ID = cfg.telegram.chatId;
            PORT = "4321";
          };
          image = cfg.containers.advocat;
          # Gleiche Besitzer wie die Ordner aus preStart, sonst gehören neue Dateien root.
          user = "${toString config.neo.core.uid}:${toString config.neo.core.gid}";
          autoStart = true;
          volumes = [
            "${appdata}/content:/content"
            "${appdata}/site:/site"
            "${appdata}/anfragen:/anfragen"
          ];
          networks = ["internal"];
        };
      };
    };
}
