import React from "react";
import { CompactSelect } from "./ui/compact-select";

type MicrophoneDevice = {
  id: string;
  label: string;
};

interface OnboardingMicSelectorProps {
  devices: MicrophoneDevice[];
  selectedId: string;
  onChange: (value: string) => void;
}

const OnboardingMicSelector: React.FC<OnboardingMicSelectorProps> = ({
  devices,
  selectedId,
  onChange,
}) => (
  <CompactSelect
    aria-label="Microphone"
    value={selectedId}
    onValueChange={onChange}
    options={devices.map((device) => ({
      value: device.id,
      label: device.label || "Microphone",
    }))}
  />
);

export default OnboardingMicSelector;
