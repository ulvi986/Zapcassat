import { Boxes, DoorOpen, Droplets, Grid3x3, Hammer, Layers, Package, PaintBucket, PanelsTopLeft, Trees, Wrench, Zap, type LucideIcon } from "lucide-react"

const ICONS: Record<string, LucideIcon> = {
  "door-open": DoorOpen,
  trees: Trees,
  layers: Layers,
  "grid-3x3": Grid3x3,
  package: Package,
  "panels-top-left": PanelsTopLeft,
  "paint-bucket": PaintBucket,
  hammer: Hammer,
  droplets: Droplets,
  zap: Zap,
  wrench: Wrench,
  boxes: Boxes,
}

export function categoryIcon(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Package
}
