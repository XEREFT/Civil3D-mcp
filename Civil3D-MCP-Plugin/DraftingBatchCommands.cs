using Autodesk.AutoCAD.Colors;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using System.Text.Json.Nodes;

namespace Civil3DMcpPlugin;

// Creates many drafting entities (lines, polylines, text, mtext, mleaders, aligned dimensions,
// block references) in ONE transaction and ONE approval, each with explicit layer, color, linetype,
// lineweight and style. Used to replay a firm drafting standard (layer/style recipes extracted from
// a finished sheet) on a new project without one tool call per entity. All-or-nothing: any invalid
// item aborts the whole batch.
public static class DraftingBatchCommands
{
  private const int MaxEntities = 500;

  public static Task<object?> CreateEntitiesAsync(JsonObject? parameters)
  {
    if (PluginRuntime.GetParameter(parameters, "entities") is not JsonArray items || items.Count == 0)
    {
      throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", "createEntities requires a non-empty 'entities' array.");
    }

    if (items.Count > MaxEntities)
    {
      throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", $"createEntities accepts at most {MaxEntities} entities per call; split the batch.");
    }

    var layerDefinitions = PluginRuntime.GetParameter(parameters, "layers") as JsonObject;
    var space = AcadCommands.ParseTargetSpace(parameters);
    var layoutName = PluginRuntime.GetOptionalString(parameters, "layout");

    return CivilExecution.WriteAsync<object?>((doc, civilDoc, database, transaction) =>
    {
      var (targetSpace, targetLayoutName) = AcadCommands.ResolveTargetSpace(database, transaction, space, layoutName);
      var layersCreated = EnsureLayers(database, transaction, layerDefinitions);
      var created = new List<Dictionary<string, object?>>();

      for (var index = 0; index < items.Count; index++)
      {
        if (items[index] is not JsonObject item)
        {
          throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", $"entities[{index}] must be an object.");
        }

        var kind = (PluginRuntime.GetOptionalString(item, "kind") ?? string.Empty).Trim().ToLowerInvariant();
        Entity entity;
        try
        {
          entity = kind switch
          {
            "line" => BuildLine(item),
            "polyline" => BuildPolyline(item),
            "text" => BuildText(database, transaction, item),
            "mtext" => BuildMText(database, transaction, item),
            "mleader" => BuildMLeader(database, transaction, item),
            "aligned_dimension" => BuildAlignedDimension(database, transaction, item),
            "block" => BuildBlock(transaction, database, item),
            _ => throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT",
              "kind must be one of line, polyline, text, mtext, mleader, aligned_dimension, block."),
          };
        }
        catch (JsonRpcDispatchException ex)
        {
          throw new JsonRpcDispatchException(ex.Code, $"entities[{index}] ({kind}): {ex.Message}");
        }

        using (entity)
        {
          ApplyCommonProperties(database, transaction, entity, item, index);
          targetSpace.AppendEntity(entity);
          transaction.AddNewlyCreatedDBObject(entity, true);
          if (entity is Dimension dimension)
          {
            dimension.RecomputeDimensionBlock(true);
          }

          if (entity is MLeader mleader)
          {
            OrientMLeader(mleader, item);
          }

          created.Add(new Dictionary<string, object?>
          {
            ["index"] = index,
            ["kind"] = kind,
            ["handle"] = entity.Handle.ToString(),
            ["layer"] = entity.Layer,
          });
        }
      }

      return new Dictionary<string, object?>
      {
        ["createdCount"] = created.Count,
        ["created"] = created,
        ["layersCreated"] = layersCreated,
        ["space"] = space,
        ["layout"] = targetLayoutName,
      };
    });
  }

  // Layers named in `layers` are created with those properties when missing; existing layers are
  // left untouched so a project's own layer overrides survive.
  private static List<string> EnsureLayers(Database database, Transaction transaction, JsonObject? definitions)
  {
    var createdNames = new List<string>();
    if (definitions == null)
    {
      return createdNames;
    }

    var layerTable = CivilObjectUtils.GetRequiredObject<LayerTable>(transaction, database.LayerTableId, OpenMode.ForRead);
    foreach (var (name, node) in definitions)
    {
      if (layerTable.Has(name))
      {
        continue;
      }

      var definition = node as JsonObject;
      var layer = new LayerTableRecord { Name = name };
      var colorIndex = PluginRuntime.GetOptionalInt(definition, "colorIndex");
      if (colorIndex.HasValue)
      {
        layer.Color = Color.FromColorIndex(ColorMethod.ByAci, (short)colorIndex.Value);
      }

      var linetype = PluginRuntime.GetOptionalString(definition, "linetype");
      if (!string.IsNullOrWhiteSpace(linetype))
      {
        layer.LinetypeObjectId = LookupUtils.GetOrLoadLinetypeId(database, transaction, linetype);
      }

      var lineweight = PluginRuntime.GetOptionalInt(definition, "lineweight");
      if (lineweight.HasValue)
      {
        layer.LineWeight = (LineWeight)lineweight.Value;
      }

      var plot = PluginRuntime.GetOptionalBool(definition, "plot");
      if (plot.HasValue)
      {
        layer.IsPlottable = plot.Value;
      }

      layerTable.UpgradeOpen();
      layerTable.Add(layer);
      transaction.AddNewlyCreatedDBObject(layer, true);
      createdNames.Add(name);
    }

    return createdNames;
  }

  private static void ApplyCommonProperties(Database database, Transaction transaction, Entity entity, JsonObject item, int index)
  {
    var layerName = PluginRuntime.GetOptionalString(item, "layer");
    if (!string.IsNullOrWhiteSpace(layerName))
    {
      var layerTable = CivilObjectUtils.GetRequiredObject<LayerTable>(transaction, database.LayerTableId, OpenMode.ForRead);
      if (!layerTable.Has(layerName))
      {
        throw new JsonRpcDispatchException("CIVIL3D.OBJECT_NOT_FOUND",
          $"entities[{index}]: layer '{layerName}' does not exist. Define it in 'layers' so it is created with the standard's properties.");
      }

      entity.LayerId = layerTable[layerName];
    }

    var colorIndex = PluginRuntime.GetOptionalInt(item, "colorIndex");
    if (colorIndex.HasValue)
    {
      entity.Color = colorIndex.Value switch
      {
        256 => Color.FromColorIndex(ColorMethod.ByLayer, 256),
        0 => Color.FromColorIndex(ColorMethod.ByBlock, 0),
        _ => Color.FromColorIndex(ColorMethod.ByAci, (short)colorIndex.Value),
      };
    }

    var linetype = PluginRuntime.GetOptionalString(item, "linetype");
    if (!string.IsNullOrWhiteSpace(linetype))
    {
      entity.LinetypeId = LookupUtils.GetOrLoadLinetypeId(database, transaction, linetype);
    }

    var linetypeScale = PluginRuntime.GetOptionalDouble(item, "linetypeScale");
    if (linetypeScale.HasValue)
    {
      entity.LinetypeScale = linetypeScale.Value;
    }

    var lineweight = PluginRuntime.GetOptionalInt(item, "lineweight");
    if (lineweight.HasValue)
    {
      entity.LineWeight = (LineWeight)lineweight.Value;
    }
  }

  private static List<Point2d> ReadPoints(JsonObject item, int minimum)
  {
    if (PluginRuntime.GetParameter(item, "points") is not JsonArray pointsNode || pointsNode.Count < minimum)
    {
      throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", $"needs 'points' with at least {minimum} {{x, y}} items.");
    }

    return pointsNode.Select(node => node is JsonObject point
        ? new Point2d(
          point["x"]?.GetValue<double>() ?? throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", "point is missing x."),
          point["y"]?.GetValue<double>() ?? throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", "point is missing y."))
        : throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", "each point must be {x, y}."))
      .ToList();
  }

  private static Entity BuildLine(JsonObject item)
  {
    var points = ReadPoints(item, 2);
    return new Line(new Point3d(points[0].X, points[0].Y, 0), new Point3d(points[1].X, points[1].Y, 0));
  }

  private static Entity BuildPolyline(JsonObject item)
  {
    var points = ReadPoints(item, 2);
    var width = PluginRuntime.GetOptionalDouble(item, "constantWidth") ?? 0d;
    var polyline = new Polyline();
    for (var i = 0; i < points.Count; i++)
    {
      polyline.AddVertexAt(i, points[i], 0, width, width);
    }

    polyline.Closed = PluginRuntime.GetOptionalBool(item, "closed") ?? false;
    return polyline;
  }

  private static Entity BuildText(Database database, Transaction transaction, JsonObject item)
  {
    var text = new DBText
    {
      TextString = PluginRuntime.GetRequiredString(item, "text"),
      Position = new Point3d(PluginRuntime.GetRequiredDouble(item, "x"), PluginRuntime.GetRequiredDouble(item, "y"), 0),
      Height = PluginRuntime.GetOptionalDouble(item, "height") ?? 2.5d,
      Rotation = PluginRuntime.GetOptionalDouble(item, "rotation") ?? 0d,
    };
    var styleId = ResolveTextStyleId(database, transaction, PluginRuntime.GetOptionalString(item, "textStyle"));
    if (!styleId.IsNull)
    {
      text.TextStyleId = styleId;
    }

    return text;
  }

  private static Entity BuildMText(Database database, Transaction transaction, JsonObject item)
  {
    var mtext = new MText
    {
      Contents = PluginRuntime.GetRequiredString(item, "text"),
      Location = new Point3d(PluginRuntime.GetRequiredDouble(item, "x"), PluginRuntime.GetRequiredDouble(item, "y"), 0),
      TextHeight = PluginRuntime.GetOptionalDouble(item, "height") ?? 2.5d,
      Rotation = PluginRuntime.GetOptionalDouble(item, "rotation") ?? 0d,
    };
    var styleId = ResolveTextStyleId(database, transaction, PluginRuntime.GetOptionalString(item, "textStyle"));
    if (!styleId.IsNull)
    {
      mtext.TextStyleId = styleId;
    }

    var width = PluginRuntime.GetOptionalDouble(item, "width");
    if (width is > 0)
    {
      mtext.Width = width.Value;
    }

    var attachment = PluginRuntime.GetOptionalInt(item, "attachment");
    if (attachment.HasValue)
    {
      if (attachment.Value is < 1 or > 9)
      {
        throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", "attachment must be 1-9 (1 TopLeft, 2 TopCenter, 3 TopRight, 4 MiddleLeft, 5 MiddleCenter, 6 MiddleRight, 7 BottomLeft, 8 BottomCenter, 9 BottomRight).");
      }

      mtext.Attachment = (AttachmentPoint)attachment.Value;
    }

    return mtext;
  }

  private static Entity BuildMLeader(Database database, Transaction transaction, JsonObject item)
  {
    var text = PluginRuntime.GetRequiredString(item, "text");
    var arrowPoint = new Point3d(PluginRuntime.GetRequiredDouble(item, "leaderX"), PluginRuntime.GetRequiredDouble(item, "leaderY"), 0);
    var textPoint = new Point3d(PluginRuntime.GetRequiredDouble(item, "x"), PluginRuntime.GetRequiredDouble(item, "y"), 0);
    var styleName = PluginRuntime.GetOptionalString(item, "mLeaderStyle");

    var mleader = new MLeader();
    mleader.SetDatabaseDefaults(database);
    var styleDict = CivilObjectUtils.GetRequiredObject<DBDictionary>(transaction, database.MLeaderStyleDictionaryId, OpenMode.ForRead);
    if (!string.IsNullOrWhiteSpace(styleName))
    {
      if (!styleDict.Contains(styleName))
      {
        var available = string.Join(", ", styleDict.Cast<DBDictionaryEntry>().Select(entry => entry.Key));
        throw new JsonRpcDispatchException("CIVIL3D.OBJECT_NOT_FOUND", $"MLeader style '{styleName}' not found. Available: {available}.");
      }

      mleader.MLeaderStyle = styleDict.GetAt(styleName);
    }

    using var mtext = new MText { Contents = text, Location = textPoint };
    var height = PluginRuntime.GetOptionalDouble(item, "height");
    if (height.HasValue)
    {
      mtext.TextHeight = height.Value;
    }

    mleader.MText = mtext;
    var leaderIndex = mleader.AddLeaderLine(arrowPoint);
    mleader.AddLastVertex(leaderIndex, textPoint);
    return mleader;
  }

  // Scale, text angle and dogleg need a database-resident MLeader (eInvalidContext otherwise), so they
  // are applied after AppendEntity. On a twisted sheet viewport the text is rotated to the street
  // angle to read horizontally, and the dogleg follows that direction toward the text side.
  private static void OrientMLeader(MLeader mleader, JsonObject item)
  {
    var rotation = PluginRuntime.GetOptionalDouble(item, "rotation");
    var scale = PluginRuntime.GetOptionalDouble(item, "scale");
    if (!rotation.HasValue && !scale.HasValue)
    {
      return;
    }

    var height = PluginRuntime.GetOptionalDouble(item, "height");
    // An annotative MLeader takes its scale from the annotation scale (CANNOSCALE); setting Scale throws eInvalidContext.
    if (scale.HasValue && mleader.Annotative != AnnotativeStates.True)
    {
      mleader.Scale = scale.Value;
    }

    using var mtext = mleader.MText;
    if (height.HasValue)
    {
      mtext.TextHeight = height.Value;
    }

    if (rotation.HasValue)
    {
      mleader.TextAngleType = TextAngleType.InsertAngle;
      mtext.Rotation = rotation.Value;
    }

    mleader.MText = mtext;
    var leaderIndexes = mleader.GetLeaderIndexes();
    if (rotation.HasValue && leaderIndexes.Count > 0)
    {
      var arrow = new Point3d(PluginRuntime.GetRequiredDouble(item, "leaderX"), PluginRuntime.GetRequiredDouble(item, "leaderY"), 0);
      var textPoint = new Point3d(PluginRuntime.GetRequiredDouble(item, "x"), PluginRuntime.GetRequiredDouble(item, "y"), 0);
      var along = new Vector3d(Math.Cos(rotation.Value), Math.Sin(rotation.Value), 0);
      mleader.SetDogleg((int)leaderIndexes[0], (textPoint - arrow).DotProduct(along) >= 0 ? along : along.Negate());
    }
  }

  private static Entity BuildAlignedDimension(Database database, Transaction transaction, JsonObject item)
  {
    var p1 = new Point3d(PluginRuntime.GetRequiredDouble(item, "x1"), PluginRuntime.GetRequiredDouble(item, "y1"), 0);
    var p2 = new Point3d(PluginRuntime.GetRequiredDouble(item, "x2"), PluginRuntime.GetRequiredDouble(item, "y2"), 0);
    if (p1.DistanceTo(p2) < 1e-9)
    {
      throw new JsonRpcDispatchException("CIVIL3D.INVALID_INPUT", "the two dimension points are identical.");
    }

    var dimension = new AlignedDimension();
    dimension.SetDatabaseDefaults(database);
    dimension.XLine1Point = p1;
    dimension.XLine2Point = p2;
    dimension.DimLinePoint = DimensionViewportCommands.ComputeDimLinePoint(
      p1, p2,
      PluginRuntime.GetOptionalDouble(item, "dimLineX"),
      PluginRuntime.GetOptionalDouble(item, "dimLineY"),
      PluginRuntime.GetOptionalDouble(item, "offset") ?? 0d);
    dimension.DimensionStyle = DimensionViewportCommands.ResolveDimStyleId(database, transaction, PluginRuntime.GetOptionalString(item, "dimStyle"));
    dimension.DimensionText = PluginRuntime.GetOptionalString(item, "textOverride") ?? string.Empty;
    return dimension;
  }

  private static Entity BuildBlock(Transaction transaction, Database database, JsonObject item)
  {
    var blockName = PluginRuntime.GetRequiredString(item, "blockName");
    var blockTable = CivilObjectUtils.GetRequiredObject<BlockTable>(transaction, database.BlockTableId, OpenMode.ForRead);
    if (!blockTable.Has(blockName))
    {
      throw new JsonRpcDispatchException("CIVIL3D.OBJECT_NOT_FOUND",
        $"block '{blockName}' is not defined in this drawing. Import it first with acad_insert_block_reference (sourceFilePath).");
    }

    var scale = PluginRuntime.GetOptionalDouble(item, "scale") ?? 1d;
    return new BlockReference(
      new Point3d(PluginRuntime.GetRequiredDouble(item, "x"), PluginRuntime.GetRequiredDouble(item, "y"), 0),
      blockTable[blockName])
    {
      Rotation = PluginRuntime.GetOptionalDouble(item, "rotation") ?? 0d,
      ScaleFactors = new Scale3d(scale),
    };
  }

  private static ObjectId ResolveTextStyleId(Database database, Transaction transaction, string? styleName)
  {
    if (string.IsNullOrWhiteSpace(styleName))
    {
      return ObjectId.Null;
    }

    var styleTable = CivilObjectUtils.GetRequiredObject<TextStyleTable>(transaction, database.TextStyleTableId, OpenMode.ForRead);
    if (styleTable.Has(styleName))
    {
      return styleTable[styleName];
    }

    var available = new List<string>();
    foreach (ObjectId id in styleTable)
    {
      available.Add(CivilObjectUtils.GetRequiredObject<TextStyleTableRecord>(transaction, id, OpenMode.ForRead).Name);
    }

    throw new JsonRpcDispatchException("CIVIL3D.OBJECT_NOT_FOUND", $"text style '{styleName}' not found. Available: {string.Join(", ", available.Where(n => n.Length > 0))}.");
  }
}
