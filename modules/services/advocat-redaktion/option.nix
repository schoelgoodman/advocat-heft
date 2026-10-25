# Advocat-Redaktion: eigener Name für den Editor, damit SWAG ein Zertifikat holt.
# Kein eigener Container. Der Upstream ist der Container von neo.services.advocat.
{...}: {
  flake.modules.nixos.advocat-redaktion-option = {
    config,
    lib,
    ...
  }:
    with lib;
    with {inherit (lib.neo) mkOption mkEnableOption;}; {
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
            // lib.neo.mkServiceMeta {
              category = "Other";
              icon = ./icon.png;
              description = ''
                Der Editor für das Heft von Advocat Finanz, hinter tinyauth.
                Braucht den Dienst Advocat Finanz. Hat keinen eigenen Prozess: die Seite
                und die Redaktion laufen im selben Container. Darum zeigt Neo hier keine
                Units. Stoppen und Neustarten geht über Advocat Finanz.
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
