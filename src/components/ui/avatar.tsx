import React, { useState } from "react";
import { cn } from "../../lib/utils";

export type AvatarProps = {
  src?: string | null;
  alt: string;
  size?: "md" | "lg";
  className?: string;
  fallbackLabel?: string | null;
};

const sizeMap: Record<NonNullable<AvatarProps["size"]>, string> = {
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  size = "md",
  className,
  fallbackLabel,
}) => {
  const [imageError, setImageError] = useState(false);
  const initials = (fallbackLabel && fallbackLabel.trim().charAt(0)) || "?";
  const showImage = Boolean(src && !imageError);

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 text-white/80 shadow-sm",
        sizeMap[size],
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
