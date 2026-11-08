import { useEffect, useState } from 'react';
import { fetchScene } from '../scenesApi';
import { Icon } from '../components/Icon';
export function EncounterThumbnail({ sceneId }: { sceneId?: string }) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setImage(null);
    if (sceneId)
      fetchScene(sceneId)
        .then((scene) => {
          if (active) setImage(scene.backgroundImageUrl);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [sceneId]);
  return image ? <img src={image} alt="" /> : <Icon name="sword" />;
}
