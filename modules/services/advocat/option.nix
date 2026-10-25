# Advocat-Heft: öffentliche Seite und Redaktion, ein Container.
{withSystem, ...}: {
  flake.modules.nixos.advocat-option = {
    config,
    lib,
    pkgs,
    ...
  }:
    with lib;
    with {inherit (lib.neo) mkOption mkEnableOption;}; let
      image = withSystem pkgs.stdenv.hostPlatform.system ({config, ...}: config.packages.advocat-heft-image);
    in {
      options.neo.services.advocat = mkOption {
        type = types.submodule {
          options =
            {
              enabled = mkEnableOption "Advocat Finanz" {rank = 0;};
              telegram = {
                botToken = mkOption {
                  type = types.str;
                  default = "";
                  rank = 10;
                  description = ''
                    Token des Telegram-Bots (von @BotFather). Jede Anfrage aus dem Kontaktformular
                    kommt dann als Nachricht. Leer: keine Nachricht, die Anfrage liegt trotzdem unter
                    <appdata>/advocat/anfragen.
                  '';
                };
                chatId = mkOption {
                  type = types.str;
                  default = "";
                  rank = 20;
                  description = ''
                    Chat, in den der Bot schreibt: eine Benutzer-ID oder eine Gruppen-ID (beginnt mit -).
                    Dem Bot vorher einmal schreiben bzw. ihn in die Gruppe aufnehmen, sonst darf er nicht.
                  '';
                };
              };
            }
            // neo.mkReverseProxyOptions {
              subdomain = "advocat";
              # Die Seite ist öffentlich. Die Anmeldung gehört zu advocat-redaktion.
              auth.available = false;
            }
            // neo.mkVpnOptions {
              containers = ["advocat"];
              networks = ["internal"];
              ports = [4321];
            }
            // lib.neo.mkContainerDefinitions {
              # Von diesem Flake gebaut, geladen von advocat-image.service.
              # Das Image enthält nur den Setzer, kein Markdown.
              advocat = image.imageRefUnsafe;
              extraUnits = ["advocat-image"];
            }
            // lib.neo.mkAppdata "${config.neo.core.volumes.appdata}/advocat"
            // lib.neo.mkServiceMeta {
              category = "Other";
              icon = ./icon.png;
              description = ''
                Das Heft von Advocat Finanz. Die öffentliche Seite steht unter dem
                Subdomain-Namen. Die Redaktion ist der Dienst Advocat Redaktion, hinter
                tinyauth. Markdown und Bilder liegen auf dem Appdata-Volume, nicht im Image.
              '';
              projectUrl = "https://advocat-finanz.ch/";
              githubUrl = "https://github.com/schoelgoodman/advocat-heft";
            }
            // lib.neo.mkSkillOptions {};
        };
        default = {};
        description = "Advocat Finanz: Heft, Redaktion und Fassungen";
      };
    };
}
