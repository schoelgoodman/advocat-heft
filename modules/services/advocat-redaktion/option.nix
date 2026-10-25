# Advocat-Redaktion: der Editor als eigener Dienst, mit eigenem Namen (damit SWAG ein
# Zertifikat holt) und eigenem Container aus dem Image von neo.services.advocat.
{withSystem, ...}: {
  flake.modules.nixos.advocat-redaktion-option = {
    config,
    lib,
    pkgs,
    ...
  }:
    with lib;
    with {inherit (lib.neo) mkOption mkEnableOption;}; let
      image = withSystem pkgs.stdenv.hostPlatform.system ({config, ...}: config.packages.advocat-heft-image);
    in {
      options.neo.services.advocat-redaktion = mkOption {
        type = types.submodule {
          options =
            {
              enabled = mkEnableOption "Advocat Redaktion" {rank = 0;};
            }
            // neo.mkReverseProxyOptions {
              subdomain = "redaktion";
              auth.enabled = true;
            }
            // lib.neo.mkContainerDefinitions {
              # Dasselbe Image wie advocat, geladen von advocat-image.service. Die Unit
              # gehört advocat: stünde sie auch hier, hielte Stop der Redaktion die Seite an.
              advocat-redaktion = image.imageRefUnsafe;
            }
            // lib.neo.mkServiceMeta {
              category = "Other";
              icon = ./icon.png;
              description = ''
                Der Editor für das Heft von Advocat Finanz, hinter tinyauth.
                Braucht den Dienst Advocat Finanz. Eigener Container aus demselben Image:
                Stoppen der Redaktion lässt die öffentliche Seite online.
              '';
              projectUrl = "https://advocat-finanz.ch/";
              githubUrl = "https://github.com/schoelgoodman/advocat-heft";
            };
        };
        default = {};
        description = "Advocat Finanz: Redaktion unter eigenem Namen";
      };
    };
}
