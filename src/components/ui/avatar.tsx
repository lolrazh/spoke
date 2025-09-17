import React, { useState } from "react";
import { cn } from "../../lib/utils";

export type AvatarProps = {
  src?: string | null;
  alt: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  fallbackLabel?: string | null;
  shape?: "circle" | "rounded";
};

const sizeMap: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

const shapeMap: Record<NonNullable<AvatarProps["shape"]>, string> = {
  circle: "rounded-full",
  rounded: "rounded-[var(--radius)]",
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  size = "md",
  className,
  fallbackLabel,
  shape = "circle",
}) => {
  const [imageError, setImageError] = useState(false);
  const initials = (fallbackLabel && fallbackLabel.trim().charAt(0)) || "?";
  const showImage = Boolean(src && !imageError);

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden border border-white/20 bg-white/10 text-white/80 shadow-sm",
        sizeMap[size],
        shapeMap[shape],
        className,
      )}
      aria-label={alt}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <span className="text-base font-semibold uppercase tracking-wide">
          {initials}
        </span>
      )}
      <span className="sr-only">{alt}</span>
    </div>
  );
};

export default Avatar;
