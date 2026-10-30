const logos: Record<string, { src: string; width: number; height: number; plate: "light" | "dark" }> = {
  cfac: { src: "/client-marks/cfac.png", width: 510, height: 132, plate: "light" },
  cedar: { src: "/client-marks/cedar.png", width: 654, height: 248, plate: "dark" },
  sunrise: { src: "/client-marks/sunrise.png", width: 542, height: 170, plate: "dark" },
  sdic: { src: "/client-marks/sdic.png", width: 446, height: 132, plate: "light" },
  msdc: { src: "/client-marks/msdc.png", width: 486, height: 100, plate: "light" },
  sbsn: { src: "/client-marks/sbsn.png", width: 504, height: 184, plate: "light" },
  aqua: { src: "/client-marks/aqua.png", width: 320, height: 408, plate: "light" },
  pilot: { src: "/client-marks/pilot.png", width: 1920, height: 345, plate: "light" },
  joyful: { src: "/client-marks/joyful.png", width: 530, height: 178, plate: "light" },
  tac: { src: "/client-marks/tac.png", width: 256, height: 256, plate: "light" },
  thsc: { src: "/client-marks/thsc.png", width: 640, height: 171, plate: "light" },
  komo: { src: "/client-marks/komo.png", width: 720, height: 273, plate: "dark" },
  "clinic-genie": { src: "/brandmark.svg", width: 288, height: 288, plate: "light" },
};

function initials(shortCode: string | null, name: string) {
  const code = shortCode?.replace(/[^A-Za-z0-9]/g, "") ?? "";
  if (code.length >= 2 && code.length <= 5) return code.toUpperCase();
  const words = name.split(/\s+/).filter((word) => /[A-Za-z]/.test(word[0] ?? ""));
  const letters = words.slice(0, 2).map((word) => word[0]).join("");
  return (letters || name.slice(0, 2) || "CG").toUpperCase();
}

export function ClientMark({ slug, name, shortCode, size = "lg" }: { slug: string; name: string; shortCode: string | null; size?: "lg" | "sm" }) {
  const logo = logos[slug];
  if (logo) {
    const wide = logo.width / logo.height > 1.4;
    const frame = size === "lg" ? (wide ? "h-20 w-44" : "size-20") : wide ? "h-11 w-24" : "size-11";
    return (
      <span className={`grid shrink-0 place-items-center overflow-hidden rounded-2xl p-2 ring-4 ring-surface ${frame} ${logo.plate === "dark" ? "bg-ink" : "bg-surface"}`}>
        <img src={logo.src} alt="" width={logo.width} height={logo.height} className="h-full w-full object-contain" />
      </span>
    );
  }
  const mark = initials(shortCode, name);
  const frame = size === "lg" ? "size-20" : "size-11";
  const text = size === "lg" ? (mark.length > 3 ? "text-sm" : "text-lg") : "text-[10px]";
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-surface font-semibold tracking-wide text-action ring-4 ring-surface ${frame} ${text}`} aria-hidden="true">
      {mark}
    </span>
  );
}
