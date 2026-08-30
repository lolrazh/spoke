import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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
  <Select value={selectedId} onValueChange={onChange}>
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Select microphone" />
    </SelectTrigger>
    <SelectContent inPlace>
      {devices.map((device) => (
        <SelectItem key={device.id} value={device.id} className="text-sm">
          {device.label || "Microphone"}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export default OnboardingMicSelector;
