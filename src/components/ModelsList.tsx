import React from "react";
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
const ModelsList: React.FC<{ enabled?: boolean; inGroup?: boolean }> = ({
  enabled,
  inGroup = true,
}) => {
  const { rows, install, remove, cancel, setActive, loaded } = useModels({
    enabled,
  });

  return (
    <>
      {rows.map((row) => (
        <ModelInstallCard
          key={row.info.modelId}
          info={row.info}
          status={row.status}
          isActive={row.isActive}
          loaded={loaded}
          onInstall={() => install(row.info.modelId)}
          onRemove={() => remove(row.info.modelId)}
          onCancel={() => cancel(row.info.modelId)}
          onActivate={() => setActive(row.info.modelId)}
          inGroup={inGroup}
        />
      ))}
    </>
  );
};

export default ModelsList;
