import React, { useEffect } from "react";
import { useModels } from "../hooks/useModels";
import ModelInstallCard from "./ModelInstallCard";

/**
 * Renders the installable ASR models as a stacked list of cards (the default
 * model first).
 *
 * In Settings (`inGroup`, the default) it returns a fragment so the cards slot
 * into the bordered group container that draws the shared borders. In
 * onboarding (`inGroup={false}`) each card stands alone with its own border, so
 * a parent can space them out as two distinct stacked cards.
 */
const ModelsList: React.FC<{
  enabled?: boolean;
  inGroup?: boolean;
  onActiveModelReadyChange?: (ready: boolean) => void;
}> = ({ enabled, inGroup = true, onActiveModelReadyChange }) => {
  const {
    rows,
    activeStatus,
    install,
    remove,
    cancel,
    setActive,
    loaded,
  } = useModels({ enabled });

  useEffect(() => {
    onActiveModelReadyChange?.(activeStatus?.state === "ready");
  }, [activeStatus?.state, onActiveModelReadyChange]);

  return (
    <>
      {rows.map((row) => (
        <ModelInstallCard
          key={row.info.modelId}
          info={row.info}
          status={row.status}
          isActive={row.isActive}
          loaded={loaded}
          onInstall={install}
          onRemove={remove}
          onCancel={cancel}
          onActivate={setActive}
          inGroup={inGroup}
        />
      ))}
    </>
  );
};

export default React.memo(ModelsList);
