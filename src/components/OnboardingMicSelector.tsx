import React from "react";
import { NativeSelect } from "./ui/native-select";

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
  <NativeSelect
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
