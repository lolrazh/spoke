import React from "react";
import { useModels } from "../hooks/useModels";
import ModelInstallCard from "./ModelInstallCard";

/**
 * Renders the installable ASR models as a stacked list of cards (the default
 * model first). Returns a fragment so it slots into the Settings group
 * container that draws the shared borders.
 */
const ModelsList: React.FC<{ enabled?: boolean }> = ({ enabled }) => {
  const { rows, install, remove, setActive, loaded } = useModels({ enabled });

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
          onActivate={() => setActive(row.info.modelId)}
          inGroup
        />
      ))}
    </>
  );
};

export default ModelsList;
