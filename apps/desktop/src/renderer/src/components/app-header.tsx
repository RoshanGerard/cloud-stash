"use client";

// AppHeader — Decision 14 (review-round-1) extended by the Motion Safe phase
// and add-frameless-window-chrome (this is now the window's unified title bar).
// Persistent brand chrome at the top of the renderer. Mounted once in the
// RootLayout so it stays put across any future routes. Elements:
//
//   [logo] CloudStash        [settings] [ThemeSwitcher] │ [– ▢ ✕]
//
// The header IS the OS drag region (`app-drag`); the settings/theme sub-group
// and the window controls opt out with `app-no-drag`. On Windows/Linux the
// right edge carries custom minimize/maximize-restore/close controls; on macOS
// none render and the left side reserves inset padding for the native traffic
// lights (design.md Decisions 2, 3, 7).
//
// Settings button opens the SettingsDialog (Motion Safe toggle). Sits
// BEFORE the ThemeSwitcher in DOM order so the visual reading is
// settings-then-theme, left-to-right. Ghost/icon variant matches the
// ThemeSwitcher trigger for visual consistency across chrome affordances.
//
// Dialog open-state is lifted to this component; the Settings button click
// captures its own `currentTarget` so focus can be restored to it on close
// (Radix's default restoration is unreliable in jsdom without an explicit
// returnFocusTo — same pattern as AddDatasourceDialog in the datasources
// feature).

import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { CloudStashLogo } from "@/components/cloudstash-logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { WindowControls } from "@/components/window-controls";
import { ThemeSwitcher } from "@/features/theme/theme-switcher";
import { SettingsDialog } from "@/features/settings/settings-dialog";

export type AppHeaderProps = HTMLAttributes<HTMLElement>;

export function AppHeader({ className, ...rest }: AppHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Track the element that opened the dialog so we can restore focus
  // explicitly on close. Ref rather than state — a rerender on every click
  // is pointless.
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  // Platform is read AFTER mount (not during render) so the build-time
  // prerendered HTML — produced with no `window` — matches the first client
  // render, avoiding a hydration mismatch; the controls + macOS inset then
  // appear once the effect runs. `window.api.platform` is the static preload
  // tag (add-frameless-window-chrome).
  const [platform, setPlatform] = useState<NodeJS.Platform | undefined>(undefined);
  useEffect(() => {
    setPlatform(typeof window !== "undefined" ? window.api?.platform : undefined);
  }, []);
  const isMac = platform === "darwin";
  const showWindowControls = platform === "win32" || platform === "linux";

  return (
    <header
      className={cn(
        // The header IS the window's title bar / OS drag region; interactive
        // children opt out with `app-no-drag`. No horizontal padding on the
        // header itself so the window controls sit flush to the corner (a large
        // slam-to-corner hit target — design.md Decision 7).
        "app-drag flex h-12 shrink-0 items-center justify-between border-b border-border",
        className,
      )}
      {...rest}
    >
      <div className={cn("flex items-center gap-2 pl-4", isMac && "pl-20")}>
        <CloudStashLogo size={28} />
        {/* Wordmark in the Bricolage Grotesque display face (design.md
            Decision 4). `font-display` resolves to --font-display via the
            @theme bridge in globals.css; Geist stays the UI/body font. On
            macOS the left inset (pl-20) clears the native traffic lights. */}
        <span className="font-display text-sm font-medium">CloudStash</span>
      </div>
      <div className="flex items-center">
        <div className="app-no-drag flex items-center gap-1 px-2">
          <Button
            ref={settingsTriggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open settings"
            onClick={handleOpenSettings}
          >
            <Icon name="settings" className="size-4" aria-hidden />
            <span className="sr-only">Open settings</span>
          </Button>
          <ThemeSwitcher />
        </div>
        {showWindowControls && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
            <WindowControls />
          </>
        )}
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        returnFocusTo={settingsTriggerRef.current}
      />
    </header>
  );
}
